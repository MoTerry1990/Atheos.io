/**
 * What Atheos connects to, and how honestly.
 *
 * ## The rule this list follows
 *
 * A connector is listed as **working** only if somebody can make it work today
 * with what is deployed. Everything else is marked for what it is. A logo wall
 * of integrations that do not exist is the single most common lie on a
 * developer-tools page, and the first person who tries one and fails stops
 * believing the rest of the site.
 *
 * ## Three tiers, and why they differ
 *
 *   `mcp`   — the client speaks Model Context Protocol. Add one URL and a key
 *             and every tool works. Nothing to build per vendor.
 *   `http`  — the client cannot speak MCP but can call an HTTP endpoint with a
 *             bearer token. Works today; the user writes the request.
 *   `soon`  — genuinely not built. Named anyway, because "can I use this with
 *             X" is better answered with "not yet" than with silence.
 *
 * No vendor logos. We have no permission to use them and no relationship with
 * any of these companies — implying one would be the same misrepresentation
 * this file exists to avoid.
 */

export type ConnectorKind = "mcp" | "http" | "soon";

export interface Connector {
  name: string;
  kind: ConnectorKind;
  /** What a person actually gets out of connecting it. */
  summary: string;
  /** How to do it, in one sentence. Null when it is not possible yet. */
  how: string | null;
}

export const CONNECTORS: readonly Connector[] = [
  {
    name: "Claude",
    kind: "mcp",
    summary:
      "Ask Claude to make an image or a video and it runs on your Atheos credits, in the conversation.",
    how: "Add the Atheos MCP server in Claude's connector settings, with an API key.",
  },
  {
    name: "ChatGPT",
    kind: "mcp",
    summary:
      "Same tools inside ChatGPT — generate, then check the result without leaving the chat.",
    how: "Add Atheos as an MCP connector, or as a custom GPT action pointed at the same endpoint.",
  },
  {
    name: "Claude Code / Cursor / Windsurf",
    kind: "mcp",
    summary:
      "Generate assets from inside your editor while you are building the thing that needs them.",
    how: "Add the MCP server to the editor's config file. Any MCP-capable editor works.",
  },
  {
    name: "Gemini",
    kind: "http",
    summary:
      "Call Atheos as a function from Gemini, so it can generate and then reason about the result.",
    how: "Declare a function that POSTs to the Atheos endpoint with your key as a bearer token.",
  },
  {
    name: "Perplexity",
    kind: "http",
    summary:
      "Turn a research answer into a set of images without copying prompts by hand.",
    how: "Perplexity has no tool-calling for third parties yet, so this runs through your own script or an automation platform.",
  },
  {
    name: "n8n, Make, Zapier",
    kind: "http",
    summary:
      "Put generation inside a workflow — a new row in a sheet becomes a rendered image, on a schedule.",
    how: "Use the platform's generic HTTP request node with your key. No Atheos app to install.",
  },
  {
    name: "Your own code",
    kind: "http",
    summary:
      "One endpoint, one bearer token, JSON in and out. No SDK to install and nothing to keep up to date.",
    how: "POST to the API with Authorization: Bearer, then poll for the result.",
  },
  {
    name: "Slack and Discord",
    kind: "soon",
    summary:
      "A bot that generates in a channel, so a team shares one balance and one history.",
    how: null,
  },
  {
    name: "Figma and Canva",
    kind: "soon",
    summary:
      "Generate straight onto a canvas instead of downloading and re-uploading.",
    how: null,
  },
] as const;

/** Labels, so the page and its Spanish twin cannot drift apart. */
export const CONNECTOR_KIND_LABEL: Record<ConnectorKind, string> = {
  mcp: "One-click, via MCP",
  http: "Works today, over HTTP",
  soon: "Not built yet",
};
