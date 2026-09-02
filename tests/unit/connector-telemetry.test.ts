import { describe, expect, it, vi } from "vitest";

import {
  FORBIDDEN_KEYS,
  recordConnectorEvent,
  sanitise,
} from "@/services/connectors/telemetry";

/**
 * Logs outlive the incident they were added for.
 *
 * They get shipped to a provider, read by whoever is on call, and kept for
 * months. A prompt in a log is a copy of somebody's work in a place nobody
 * chose to put it; a token in a log is a credential at rest. Both are easy to
 * add by accident and hard to withdraw.
 *
 * So the event shape is a whitelist rather than a denylist, and these assert
 * the whitelist holds even when a caller ignores the types — which is the only
 * way it actually gets breached.
 */

describe("only vetted fields survive", () => {
  it("keeps the fields an operator needs", () => {
    const event = sanitise({
      auth: "api_key",
      operation: "prepare_generation",
      status: "ok",
      durationMs: 42,
      apiKeyRecordId: "key_row_1",
      idempotency: "first",
      generationId: "gen_public_1",
    });

    expect(event).toEqual({
      auth: "api_key",
      operation: "prepare_generation",
      status: "ok",
      durationMs: 42,
      apiKeyRecordId: "key_row_1",
      idempotency: "first",
      generationId: "gen_public_1",
    });
  });

  it("drops a prompt, a token and a key even when handed them directly", () => {
    /**
     * The types already exclude these. This is the case where somebody casts
     * to `any` in a hurry — which is exactly when a prompt reaches a log.
     */
    const event = sanitise({
      auth: "api_key",
      operation: "prepare_generation",
      status: "ok",
      durationMs: 1,
      prompt: "a very distinctive phrase",
      token: "eyJhbGciOi.forged",
      apiKey: "atk_live_secret",
      authorization: "Bearer atk_live_secret",
    } as Record<string, unknown>);

    const serialised = JSON.stringify(event);

    expect(serialised).not.toContain("distinctive");
    expect(serialised).not.toContain("atk_live");
    expect(serialised).not.toContain("eyJhbGciOi");
  });

  it("drops provider identity and signed URLs", () => {
    const event = sanitise({
      auth: "api_key",
      operation: "check_generation",
      status: "ok",
      durationMs: 1,
      providerId: "replicate",
      predictionId: "a3n0abcd1234",
      assetUrl: "https://cdn.example.test/x?signature=abc",
    } as Record<string, unknown>);

    expect(JSON.stringify(event)).not.toMatch(/replicate|a3n0abcd|signature/i);
  });

  it("names the fields it refuses, so the rule is readable", () => {
    // A denylist that nobody can see is a denylist nobody maintains.
    expect(FORBIDDEN_KEYS.length).toBeGreaterThan(5);
    for (const key of ["prompt", "token", "apiKey", "predictionId"]) {
      expect(FORBIDDEN_KEYS, key).toContain(key);
    }
  });
});

describe("what actually reaches stdout", () => {
  it("emits one line, tagged, with nothing sensitive in it", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    recordConnectorEvent({
      auth: "api_key",
      operation: "prepare_generation",
      status: "ok",
      durationMs: 12,
      apiKeyRecordId: "key_row_1",
    });

    expect(info).toHaveBeenCalledTimes(1);

    const line = info.mock.calls[0]![0] as string;
    const parsed = JSON.parse(line);

    expect(parsed.kind).toBe("connector");
    expect(parsed.apiKeyRecordId).toBe("key_row_1");
    // The record id, never the credential it identifies.
    expect(line).not.toMatch(/atk_live|Bearer/);

    info.mockRestore();
  });
});
