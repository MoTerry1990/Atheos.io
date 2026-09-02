import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Registering a provider must not be the same as offering it.
 *
 * ## What this guards
 *
 * `googleOmniProvider` is in `REAL_PROVIDERS`. That is a wiring decision, not
 * an availability one, and the distance between the two is the whole point of
 * this file: with no `GOOGLE_AI_API_KEY` the model must be invisible to the
 * studio, to `list_models`, to MCP, and unquotable — and a forged id, public
 * or internal, must be refused *before* anything is priced, reserved or run.
 *
 * The rest of Atheos must be unaffected. A missing Google credential hides one
 * model; it does not degrade the platform, and one test below asserts exactly
 * that by counting what else is still served.
 *
 * ## Why the environment is manipulated
 *
 * `lib/env.ts` captures `process.env` at import time, so each case resets the
 * module graph and re-imports. That is also the only honest way to exercise
 * "the process started without the key".
 */

const KEY = "GOOGLE_AI_API_KEY";
const FLAG = "ENABLE_GOOGLE_OMNI";
const original = { ...process.env };

async function withOmni(configured: boolean) {
  vi.resetModules();
  if (configured) {
    process.env[KEY] = "test-placeholder-not-a-key";
    process.env[FLAG] = "1";
  } else {
    delete process.env[KEY];
    delete process.env[FLAG];
  }

  const [registry, catalogue, policy, provider] = await Promise.all([
    import("@/services/ai/registry"),
    import("@/services/connectors/catalogue"),
    import("@/services/ai/model-policy"),
    import("@/services/ai/providers/google-omni"),
  ]);

  return { registry, catalogue, policy, provider };
}

afterEach(() => {
  for (const name of [KEY, FLAG]) {
    if (original[name] === undefined) delete process.env[name];
    else process.env[name] = original[name];
  }
  vi.resetModules();
});

const CATALOGUE_ID = "google/omni-1.1-flash";
const PUBLIC_ID = "cinematic-next";

describe("with no credential, the model does not exist as far as anyone can tell", () => {
  it("offers nothing from the adapter itself", async () => {
    const { provider } = await withOmni(false);

    expect(provider.googleOmniProvider.isConfigured()).toBe(false);
    expect(provider.googleOmniProvider.listModels()).toEqual([]);
  });

  it("is absent from the registry", async () => {
    const { registry } = await withOmni(false);

    expect(registry.listModels().map((m) => m.id)).not.toContain(CATALOGUE_ID);
    expect(registry.findModel(CATALOGUE_ID)).toBeNull();
  });

  it("is absent from the connector catalogue for every caller", async () => {
    // `list_models` over MCP is this function. Owner included: the policy
    // permits the owner, and the credential still does not exist.
    const { catalogue } = await withOmni(false);

    for (const caller of ["public", "owner"] as const) {
      const ids = catalogue.connectorModels(caller).map((m) => m.id);
      expect(ids, caller).not.toContain(PUBLIC_ID);
    }
  });

  it("refuses a forged public id before anything is priced", async () => {
    const { catalogue } = await withOmni(false);

    for (const caller of ["public", "owner"] as const) {
      expect(
        catalogue.resolveConnectorModel(PUBLIC_ID, caller),
        caller,
      ).toBeNull();
      expect(
        catalogue.connectorModelById(PUBLIC_ID, caller),
        caller,
      ).toBeUndefined();
    }
  });

  it("refuses a forged internal id too", async () => {
    /**
     * The catalogue path is what a client would guess if it read a policy
     * document. `resolveConnectorModel` refuses anything containing a slash
     * outright, so this never even reaches a lookup.
     */
    const { catalogue } = await withOmni(false);

    expect(catalogue.resolveConnectorModel(CATALOGUE_ID, "owner")).toBeNull();
  });

  it("cannot be quoted", async () => {
    vi.resetModules();
    delete process.env[KEY];
    delete process.env[FLAG];

    const { prepareGeneration } = await import("@/services/connectors/prepare");

    for (const id of [PUBLIC_ID, CATALOGUE_ID]) {
      const result = prepareGeneration(
        { publicModelId: id, prompt: "a surfer on a wave" },
        "owner",
        "u_1",
      );

      expect(result.ok, id).toBe(false);
      expect(result.reason, id).toBe("model_unavailable");
      // No token, no price, no row to persist.
      expect(result.prepared, id).toBeUndefined();
      expect(result.quoteRecord, id).toBeUndefined();
    }
  });

  it("changes nothing else about the catalogue", async () => {
    /**
     * The property that makes fail-closed acceptable rather than merely safe:
     * a missing Google credential hides one model and touches nothing else.
     *
     * Asserted as a difference between the two states rather than as an
     * absolute. A first version of this test checked
     * `isUsingMockProvider() === false`, which failed — correctly. There is no
     * Replicate token in the test environment either, so the registry falls
     * back to the labelled mock, and that is the designed behaviour rather
     * than a defect this file should be reporting.
     */
    const without = await withOmni(false);
    const withoutIds = without.registry
      .listModels()
      .map((m) => m.id)
      .sort();

    const configured = await withOmni(true);
    const withIds = configured.registry
      .listModels()
      .map((m) => m.id)
      .sort();

    /**
     * **One key, two adapters.** Worth knowing before anyone sets it.
     *
     * `GOOGLE_AI_API_KEY` also configures the pre-existing image adapter in
     * `providers/google.ts`, so adding it for video makes
     * `google/gemini-2.5-flash-image` appear in the registry too. This test
     * found that, and it is recorded here rather than filtered away.
     *
     * It is not an exposure: that model has **no entry in
     * `model-policy.ts`**, and `isRunnableFor` fails closed on a missing
     * policy, so it can be listed by the registry and still run for nobody.
     * The assertion below proves that rather than assuming it.
     */
    const appeared = withIds.filter((id) => !withoutIds.includes(id));
    expect(appeared.sort()).toEqual([
      "google/gemini-2.5-flash-image",
      CATALOGUE_ID,
    ]);

    /**
     * Nothing *real* disappears.
     *
     * The mock does, and that is designed: `configuredProviders()` drops it
     * the moment any real provider is configured, so it can never sit beside
     * real models where somebody could pick it by accident. In this test
     * environment there is no Replicate token either, so configuring Google is
     * what flips the mock off — in Production, Replicate is already configured
     * and the mock is already gone, so adding this key changes nothing there.
     */
    const realWithout = withoutIds.filter((id) => !id.startsWith("mock/"));
    expect(realWithout.filter((id) => !withIds.includes(id))).toEqual([]);
    expect(withoutIds).not.toContain(CATALOGUE_ID);
  });

  it("the image model the same key enables still runs for nobody", async () => {
    const { policy, catalogue } = await withOmni(true);

    // No policy entry at all — and that is a refusal, not an omission.
    expect(policy.policyFor("google/gemini-2.5-flash-image")).toBeUndefined();
    for (const caller of ["public", "owner"] as const) {
      expect(
        policy.isRunnableFor("google/gemini-2.5-flash-image", caller),
        caller,
      ).toBe(false);
      expect(
        catalogue.connectorModels(caller).map((m) => m.id),
        caller,
      ).not.toContain("atheos-image-next");
    }
  });
});

describe("the policy permits the owner, and the credential still governs", () => {
  it("records owner-evaluation status regardless of configuration", async () => {
    // Policy and availability are separate questions. The policy says who may
    // run it *if* it runs; the credential says whether it can run at all.
    const { policy } = await withOmni(false);

    const record = policy.policyFor(CATALOGUE_ID);
    expect(record?.status).toBe("OWNER_EVALUATION_ONLY_PENDING_TERMS");
    expect(record?.permittedAudience).toBe("owner");
    expect(policy.isRunnableFor(CATALOGUE_ID, "public")).toBe(false);
  });

  it("still refuses a public caller once the credential exists", async () => {
    const { catalogue, policy } = await withOmni(true);

    expect(policy.isRunnableFor(CATALOGUE_ID, "owner")).toBe(true);
    expect(policy.isRunnableFor(CATALOGUE_ID, "public")).toBe(false);

    // Configured and permitted for the owner — and never for a customer.
    expect(catalogue.connectorModels("public").map((m) => m.id)).not.toContain(
      PUBLIC_ID,
    );
    expect(catalogue.connectorModels("owner").map((m) => m.id)).toContain(
      PUBLIC_ID,
    );
  });
});

describe("the public identity carries no vendor branding", () => {
  it("names neither Google nor the model", async () => {
    const { catalogue } = await withOmni(true);

    const model = catalogue
      .connectorModels("owner")
      .find((m) => m.id === PUBLIC_ID)!;

    expect(model).toBeDefined();
    expect(model.name).toBe("Cinematic Next");
    expect(JSON.stringify(model)).not.toMatch(
      /google|gemini|omni|vertex|generativelanguage/i,
    );
  });
});
