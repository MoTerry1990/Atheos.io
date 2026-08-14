import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/lib/env";
import { listModels } from "@/services/ai/registry";
import { resolveApiKey } from "@/services/api-keys";
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

const TOOLS = [
  {
    name: "generate_image",
    description:
      "Generate an image from a text prompt using Atheos. Returns a job id " +
      "immediately; call check_generation with it to get the finished image " +
      "URL. Costs credits from the account the API key belongs to.",
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
          enum: ["1:1", "16:9", "9:16", "4:3", "3:4"],
          description: "Defaults to 1:1.",
        },
        outputs: {
          type: "integer",
          minimum: 1,
          maximum: 4,
          description: "How many variations. Each one costs credits.",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "generate_video",
    description:
      "Generate a short video from a text prompt using Atheos. Returns a job " +
      "id immediately; videos take one to several minutes, so call " +
      "check_generation to poll. Costs significantly more credits than an image.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "What should happen, and how the camera moves.",
        },
        durationSeconds: {
          type: "integer",
          enum: [5, 10],
          description: "Clip length. Ten seconds costs twice five.",
        },
        aspectRatio: { type: "string", enum: ["16:9", "9:16"] },
      },
      required: ["prompt"],
    },
  },
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
      "List the models available on this account, with their credit cost and " +
      "capabilities. Free.",
    inputSchema: { type: "object", properties: {} },
  },
] as const;

/**
 * Run a tool.
 *
 * Takes no user id: `submitGeneration` and `pollGeneration` resolve the caller
 * themselves through `requireApiUser`, which now accepts the API key on this
 * request. Passing an id in would create a second, weaker path to the same
 * authorisation decision — the thing `lib/auth.ts` exists to prevent.
 */
async function callTool(name: string, args: Record<string, unknown>) {
  switch (name) {
    case "list_models": {
      const models = listModels().map((model) => ({
        id: model.id,
        name: model.displayName,
        credits: model.creditCost,
        modality: model.modality,
      }));
      return toolResult(JSON.stringify(models, null, 2));
    }

    case "check_generation": {
      const generation = await pollGeneration(String(args.generationId ?? ""));

      return toolResult(JSON.stringify(generation, null, 2));
    }

    case "generate_image":
    case "generate_video": {
      const isVideo = name === "generate_video";

      const generation = await submitGeneration({
        operation: isVideo ? "text-to-video" : "text-to-image",
        modelId: isVideo ? "replicate/video-gen" : "replicate/flux-schnell",
        prompt: String(args.prompt ?? ""),
        aspectRatio:
          typeof args.aspectRatio === "string" ? args.aspectRatio : undefined,
        outputs: typeof args.outputs === "number" ? args.outputs : 1,
        ...(isVideo
          ? {
              durationSeconds:
                typeof args.durationSeconds === "number"
                  ? args.durationSeconds
                  : 5,
            }
          : {}),
      });

      return toolResult(
        `Started. Generation id: ${generation.generationId}\n` +
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

  if (method === "tools/list") return result(id, { tools: TOOLS });

  if (method === "tools/call") {
    const name = String(params.name ?? "");
    const args = (params.arguments ?? {}) as Record<string, unknown>;

    try {
      return result(id, await callTool(name, args));
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
    tools: TOOLS.map((tool) => tool.name),
    documentation: `${env.NEXT_PUBLIC_APP_URL}/connect`,
  });
}
