import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/lib/env";
import { isAdminClerkId } from "@/services/admin/auth";
import type { Caller } from "@/services/ai/model-policy";
import { resolveApiKey } from "@/services/api-keys";
import {
  connectorModels,
  defaultConnectorModel,
  DurationError,
  exactDuration,
  resolveConnectorModel,
  type ConnectorModel,
} from "@/services/connectors/catalogue";
import {
  GenerationError,
  pollGeneration,
  submitGeneration,
} from "@/services/generation";

/**
 * Atheos as a tool other assistants can call.
 *
 * ## What this actually is
 *
 * A **Model Context Protocol** server, spoken over HTTP as JSON-RPC 2.0. MCP is
 * the interface Claude, ChatGPT and a growing number of other clients use to
 * call an outside service. Implementing it once is what makes Atheos usable
 * from all of them — the alternative is a bespoke integration per vendor, each
 * needing that vendor's approval and none of them portable.
 *
 * Anything that cannot speak MCP can use the same capabilities over plain REST
 * at `/api/generations`, which is what a custom GPT action or an automation
 * platform will reach for.
 *
 * ## Authentication is an API key, never a session
 *
 * The caller is a program on somebody else's server. It has no cookie, no
 * browser and no way to complete an OAuth redirect. `Authorization: Bearer
 * atk_live_…`, resolved to a real user, whose credits are then spent.
 *
 * **This is a spending endpoint.** A tool call here debits the key owner's
 * balance exactly as if they had clicked Generate in the studio, which is the
 * whole point and also the reason the key is the only credential that works.
 *
 * ## Why the protocol is hand-written
 *
 * The surface used here is three methods — `initialize`, `tools/list`,
 * `tools/call` — over a request/response transport with no streaming and no
 * server-initiated messages. That is about eighty lines. An SDK would add a
 * dependency, a version to track and a bundle to ship, to save eighty lines of
 * a specification that is stable and public.
 */

/** The revision of MCP this server implements. */
const PROTOCOL_VERSION = "2025-06-18";

interface RpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

function result(id: RpcRequest["id"], value: unknown) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, result: value });
}

/**
 * A JSON-RPC error, which is **not** an HTTP error.
 *
 * The transport succeeded; the call did not. Returning 500 here makes clients
 * retry a request that will fail identically, and some drop the connection
 * entirely rather than reading the body that explains why.
 */
function rpcError(id: RpcRequest["id"], code: number, message: string) {
  return NextResponse.json({
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message },
  });
}

/** Tool output. `isError` lets the model see the failure and adapt. */
function toolResult(text: string, isError = false) {
  return { content: [{ type: "text", text }], isError };
}

/**
 * The tool list, built from the catalogue rather than written by hand.
 *
 * Every enum here used to be a literal. `durationSeconds` said `[5, 10]` while
 * Motion 1 accepts 5 and 7.5, so a client asking for ten received a
 * 7.5-second clip, priced as 7.5, having been told twice that it would get ten
 * — once by the enum and once by "ten seconds costs twice five". A schema
 * written beside a capability table is a schema that will disagree with it.
 *
 * Built per caller, because what a caller may run decides what they should be
 * offered. `models` arrives already filtered by policy.
 */
function toolsFor(models: ConnectorModel[]) {
  const image = models.find((model) => model.modality === "IMAGE");
  const video = models.find((model) => model.modality === "VIDEO");

  const tools: unknown[] = [];

  if (image) {
    tools.push({
      name: "generate_image",
      description:
        `Generate an image with ${image.name}. Returns a job id immediately; ` +
        "call check_generation with it to get the finished image URL. Costs " +
        `${image.credits} credits from the account the API key belongs to.`,
      inputSchema: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description:
              "What to generate. Be specific about subject, light and lens — " +
              "vague prompts produce vague images and still cost credits.",
          },
          aspectRatio: {
            type: "string",
            enum: [...image.aspectRatios],
            description: `Defaults to ${image.aspectRatios[0] ?? "1:1"}.`,
          },
          outputs: {
            type: "integer",
            minimum: 1,
            maximum: image.maxOutputs,
            description: "How many variations. Each one costs credits.",
          },
        },
        required: ["prompt"],
      },
    });
  }

  if (video) {
    tools.push({
      name: "generate_video",
      description:
        `Generate a short video with ${video.name}. ${video.audioNote} ` +
        "Returns a job id immediately; videos take one to several minutes, " +
        `so call check_generation to poll. Costs ${video.credits} credits at ` +
        `${Math.min(...video.durations)} seconds.`,
      inputSchema: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "What should happen, and how the camera moves.",
          },
          durationSeconds: {
            type: "number",
            enum: [...video.durations],
            description:
              "Clip length in seconds. This model accepts exactly " +
              `${video.durations.join(" or ")}; any other value is refused ` +
              "rather than rounded to the nearest.",
          },
          aspectRatio: { type: "string", enum: [...video.aspectRatios] },
        },
        required: ["prompt"],
      },
    });
  }

  tools.push(
    {
      name: "check_generation",
      description:
        "Check whether a generation has finished and get its output URLs. " +
        "Free — it spends no credits.",
      inputSchema: {
        type: "object",
        properties: {
          generationId: {
            type: "string",
            description: "The id returned by a generate tool.",
          },
        },
        required: ["generationId"],
      },
    },
    {
      name: "list_models",
      description:
        "List the models available on this account, with their credit cost " +
        "and capabilities. Free.",
      inputSchema: { type: "object", properties: {} },
    },
  );

  return tools;
}

/**
 * Run a tool.
 *
 * Takes no user id: `submitGeneration` and `pollGeneration` resolve the caller
 * themselves through `requireApiUser`, which now accepts the API key on this
 * request. Passing an id in would create a second, weaker path to the same
 * authorisation decision — the thing `lib/auth.ts` exists to prevent.
 */
async function callTool(
  name: string,
  args: Record<string, unknown>,
  caller: Caller,
) {
  switch (name) {
    case "list_models": {
      /**
       * The catalogue, filtered by policy and stripped of provider identity.
       *
       * This returned `listModels()` unfiltered — so every API-key holder was
       * shown `replicate/video-gen` and `FLUX Schnell`, plus Score, which is
       * blocked, and Motion Pro and both Cinematic tiers, which no customer
       * may buy. Submission would have refused all four; a catalogue is still
       * an offer, and offering what the server refuses is the defect this
       * codebase fixed everywhere else.
       */
      return toolResult(JSON.stringify(connectorModels(caller), null, 2));
    }

    case "check_generation": {
      const generation = await pollGeneration(String(args.generationId ?? ""));

      return toolResult(JSON.stringify(generation, null, 2));
    }

    case "generate_image":
    case "generate_video": {
      const isVideo = name === "generate_video";
      const modality = isVideo ? "VIDEO" : "IMAGE";

      const model = defaultConnectorModel(modality, caller);
      if (!model) {
        return toolResult(
          `No ${modality.toLowerCase()} model is available on this account.`,
          true,
        );
      }

      const catalogueId = resolveConnectorModel(model.id, caller);
      if (!catalogueId) {
        return toolResult("That model is not available.", true);
      }

      /**
       * An impossible duration is refused, never rounded.
       *
       * The pipeline's own `resolveDuration` snaps to the nearest allowed
       * value, which is right for a slider bounded by the same list and wrong
       * for an API whose caller is writing code against the answer.
       */
      let durationSeconds: number | undefined;
      if (isVideo) {
        try {
          durationSeconds = exactDuration(
            model,
            typeof args.durationSeconds === "number"
              ? args.durationSeconds
              : undefined,
          );
        } catch (error) {
          if (error instanceof DurationError) {
            return toolResult(
              `${model.name} does not support that clip length. ${error.message}`,
              true,
            );
          }
          throw error;
        }
      }

      const generation = await submitGeneration({
        operation: isVideo ? "text-to-video" : "text-to-image",
        modelId: catalogueId,
        prompt: String(args.prompt ?? ""),
        aspectRatio:
          typeof args.aspectRatio === "string" ? args.aspectRatio : undefined,
        outputs: typeof args.outputs === "number" ? args.outputs : 1,
        ...(isVideo ? { durationSeconds } : {}),
      });

      return toolResult(
        `Started. Generation id: ${generation.generationId}` +
          "\n" +
          // Named, because a model relaying "done!" for a placeholder would be
          // telling the user something false about their own account.
          (generation.usingMockProvider
            ? "NOTE: no provider is configured on this deployment, so the " +
              "output is a placeholder rather than a real generation.\n"
            : "") +
          `Call check_generation with this id — ` +
          `${isVideo ? "videos usually take one to three minutes" : "images usually take a few seconds"}.`,
      );
    }

    default:
      return toolResult(`Unknown tool: ${name}`, true);
  }
}

export async function POST(request: NextRequest) {
  let body: RpcRequest;
  try {
    body = (await request.json()) as RpcRequest;
  } catch {
    return rpcError(null, -32700, "Parse error");
  }

  const { id, method, params = {} } = body;

  // Answered before authentication, deliberately. A client calls `initialize`
  // to discover what it is talking to, and refusing that makes a
  // misconfigured key look like an unreachable server.
  if (method === "initialize") {
    return result(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: "atheos", version: "1.0.0" },
    });
  }

  // A notification — no id, no reply expected. `notifications/initialized`
  // arrives right after the handshake; answering it is a protocol violation
  // some clients treat as fatal.
  if (method.startsWith("notifications/")) {
    return new NextResponse(null, { status: 202 });
  }

  const user = await resolveApiKey(request.headers.get("authorization"));
  if (!user) {
    return rpcError(
      id,
      -32001,
      `Unauthorized. Send "Authorization: Bearer atk_live_…" — create a key at ${env.NEXT_PUBLIC_APP_URL}/settings/api-keys`,
    );
  }

  /**
   * The caller decides the catalogue, and it comes from the key's owner.
   *
   * Resolved from the key's owner, not from a session. `isAdmin()` reads the
   * Clerk session, which an API key does not have — so every key-holder was
   * treated as an ordinary customer and the owner could not reach their own
   * owner-evaluation models through a connector at all. It failed closed,
   * which is the right direction to fail, but it was still wrong.
   *
   * Never from a request field: the id comes from the authenticated key
   * record, so a client sending `{ role: "admin" }` has nothing to bind to.
   */
  const caller: Caller = (await isAdminClerkId(user.clerkId).catch(() => false))
    ? "owner"
    : "public";

  if (method === "tools/list") {
    return result(id, { tools: toolsFor(connectorModels(caller)) });
  }

  if (method === "tools/call") {
    const name = String(params.name ?? "");
    const args = (params.arguments ?? {}) as Record<string, unknown>;

    try {
      return result(id, await callTool(name, args, caller));
    } catch (error) {
      // Domain failures — not enough credits, bad model, prompt rejected — are
      // returned as *tool* errors rather than protocol errors, so the model
      // reads the reason and can tell the user or try something else. A
      // protocol error is opaque to it.
      if (error instanceof GenerationError) {
        return result(id, toolResult(error.message, true));
      }

      console.error("mcp: tool call failed", error);
      return result(
        id,
        toolResult("Something went wrong running that tool.", true),
      );
    }
  }

  return rpcError(id, -32601, `Method not found: ${method}`);
}

/**
 * A GET here is a person pasting the URL into a browser to see if it is real.
 * Tell them what it is rather than 405-ing at them.
 */
export function GET() {
  return NextResponse.json({
    name: "Atheos MCP server",
    protocolVersion: PROTOCOL_VERSION,
    transport: "http",
    authentication: "Authorization: Bearer <api key>",
    // Named from the public catalogue, so this description cannot drift from
    // what `tools/list` actually returns.
    tools: toolsFor(connectorModels("public")).map(
      (tool) => (tool as { name: string }).name,
    ),
    documentation: `${env.NEXT_PUBLIC_APP_URL}/connect`,
  });
}
