import { PrismaPg } from "@prisma/adapter-pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { PrismaClient } from "@/lib/generated/prisma/client";
import {
  applyMigrations,
  createIsolatedSchema,
  managedTarget,
  managedTargetConfigured,
  SCHEMA_PREFIX,
  type IsolatedSchema,
} from "./managed-schema";

/**
 * `confirmGeneration`, against real PostgreSQL on the managed test database.
 *
 * ## Why these cannot be unit tests
 *
 * Every guarantee this service makes is a database guarantee. "Two
 * simultaneous confirmations create one generation" is true because a
 * composite primary key and a conditional `UPDATE` say so, not because the
 * code checks first — a check-then-write is precisely the shape a second
 * process interleaves with. Mocking Postgres here would test the mock's
 * opinion of unique constraints.
 *
 * So each test below races real connections against real constraints, in a
 * schema created for the run and dropped after it. `createIsolatedSchema`
 * refuses any target that is not `atheos-test`, and the prefix assertion in
 * `beforeAll` is the second, independent check on that.
 *
 * ## What is mocked, and why only that
 *
 * The **registry**, because the real catalogue is assembled from a provider
 * key in the environment and these must be hermetic. The **provider dispatch**,
 * because no test may spend a vendor's money — and because everything this
 * file is about happens before it. Nothing else: the ledger, the transaction,
 * the constraints and the policy are all the real ones.
 */

const configured = managedTargetConfigured();

/** Swapped between calls so a price can move underneath a quote. */
let priceMultiplier = 1;

const FIXTURES = [
  {
    id: "replicate/flux-schnell",
    providerId: "replicate",
    displayName: "FLUX Schnell",
    modality: "IMAGE",
    creditCost: 4,
    capabilities: {
      operations: ["text-to-image"],
      maxOutputs: 4,
      aspectRatios: ["1:1", "16:9"],
      supportsImageInput: false,
    },
  },
  {
    id: "replicate/video-pro",
    providerId: "replicate",
    displayName: "Motion Pro",
    modality: "VIDEO",
    creditCost: 180,
    capabilities: {
      operations: ["text-to-video"],
      durations: [5, 10, 12],
      maxOutputs: 1,
      aspectRatios: ["16:9"],
      supportsImageInput: true,
    },
  },
];

const submit = vi.fn(async () => ({
  providerJobId: "job_test",
  state: "running" as const,
}));

vi.mock("@/services/ai/registry", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  listModels: () => FIXTURES,
  findModel: (id: string) => FIXTURES.find((m) => m.id === id) ?? null,
  priceFor: (id: string, outputs: number, seconds?: number) => {
    const model = FIXTURES.find((m) => m.id === id);
    if (!model) return 0;
    const durations = model.capabilities.durations;
    const multiplier =
      durations && seconds ? seconds / Math.min(...durations) : 1;
    return (
      Math.ceil(model.creditCost * Math.max(1, outputs) * multiplier) *
      priceMultiplier
    );
  },
  providerForModel: () => ({ id: "test", submit }),
  isUsingMockProvider: () => true,
}));

vi.mock("@/services/storage/assets", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  isStorageConfigured: () => true,
}));

/**
 * The provider hop, stubbed — and only the provider hop.
 *
 * `preflightGeneration`, `GenerationError` and `InsufficientCredits` are the
 * real ones, because the first decides whether a confirmation is allowed at
 * all and the third is what rolls the transaction back.
 */
vi.mock("@/services/generation", async (original) => {
  const actual = await original<Record<string, unknown>>();
  return {
    ...actual,
    dispatchToProvider: vi.fn(async (args: { generation: { id: string } }) => ({
      generationId: args.generation.id,
      usingMockProvider: true,
    })),
  };
});

let db: IsolatedSchema;
let client: PrismaClient;

vi.mock("@/lib/prisma", async (original) => {
  const actual = await original<Record<string, unknown>>();
  return {
    ...actual,
    // A getter, because the client does not exist until `beforeAll` has
    // created the schema it points at.
    get prisma() {
      return client;
    },
  };
});

const { prepareGeneration } = await import("@/services/connectors/prepare");
const { confirmGeneration } = await import("@/services/connectors/confirm");
const { quoteKeyFor } = await import("@/services/ai/plan-token");

const USER = "u_confirm";
const OTHER = "u_other";

/** Point a connection string at one schema, without touching its credentials. */
function schemaScoped(connectionString: string, schema: string): string {
  const separator = connectionString.includes("?") ? "&" : "?";
  return `${connectionString}${separator}options=-c%20search_path%3D${schema},public`;
}

/** Prepare a quote and persist it, exactly as the MCP route does. */
async function quote(
  over: Record<string, unknown> = {},
  userId = USER,
  caller: "public" | "owner" = "public",
) {
  const result = prepareGeneration(
    {
      publicModelId: "atheos-image-fast",
      prompt: "a lighthouse at dawn",
      outputs: 1,
      ...over,
    },
    caller,
    userId,
  );

  if (result.quoteRecord) {
    await client.connectorQuote.create({ data: result.quoteRecord });
  }
  return result;
}

const balanceOf = async (userId = USER) =>
  (
    await client.user.findUniqueOrThrow({
      where: { id: userId },
      select: { creditBalance: true },
    })
  ).creditBalance;

const counts = async (userId = USER) => ({
  generations: await client.generation.count({ where: { userId } }),
  reservations: await client.creditTransaction.count({
    where: { userId, reason: "GENERATION_RESERVATION" },
  }),
  balance: await balanceOf(userId),
});

describe.skipIf(!configured)("confirming a connector quote", () => {
  beforeAll(async () => {
    db = await createIsolatedSchema(16);
    expect(db.schema.startsWith(SCHEMA_PREFIX)).toBe(true);
    await applyMigrations(db);

    client = new PrismaClient({
      adapter: new PrismaPg(
        {
          /**
           * `search_path` as a connection-string parameter, because the
           * adapter ignores `options` passed as a pool field — every query
           * came back saying `public.users` does not exist.
           *
           * It has to be on the connection rather than only on the adapter:
           * `confirmGeneration` issues raw SQL for the two statements whose
           * atomicity is the whole point, and raw SQL is not schema-qualified
           * by anything Prisma does.
           */
          connectionString: schemaScoped(
            managedTarget().connectionString,
            db.schema,
          ),
          ssl: { rejectUnauthorized: false },
        },
        /**
         * The adapter's own schema option, not a `search_path` startup
         * parameter.
         *
         * The raw pool in `managed-schema.ts` uses `options: -c search_path=…`
         * and PrismaPg ignores it — every query came back saying
         * `public.users` does not exist. This qualifies the generated SQL
         * instead, which is the same guarantee by a different route: Prisma and
         * `pg` end up looking at the schema this run created.
         */
        { schema: db.schema },
      ),
    });
  }, 120_000);

  afterAll(async () => {
    await client?.$disconnect().catch(() => undefined);
    await db?.destroy();
  });

  beforeEach(async () => {
    priceMultiplier = 1;

    await client.$executeRawUnsafe(`DELETE FROM connector_idempotency`);
    await client.$executeRawUnsafe(`DELETE FROM connector_quote`);
    await client.$executeRawUnsafe(`DELETE FROM credit_transactions`);
    await client.$executeRawUnsafe(`DELETE FROM generations`);
    await client.$executeRawUnsafe(`DELETE FROM subscriptions`);
    await client.$executeRawUnsafe(`DELETE FROM users`);

    for (const id of [USER, OTHER]) {
      await client.user.create({
        data: {
          id,
          clerkId: `clerk_${id}`,
          email: `${id}@example.test`,
          creditBalance: 1_000,
        },
      });
      // A paid, active tier: the free plan's daily caps are a different
      // subject and would make these tests depend on how many ran before.
      await client.subscription.create({
        data: {
          userId: id,
          stripeCustomerId: `cus_${id}`,
          planTier: "PRO",
          status: "ACTIVE",
        },
      });
    }
  });

  it("charges once and returns a generation", async () => {
    const before = await counts();
    const { prepared } = await quote();

    const result = await confirmGeneration({
      token: prepared!.token,
      idempotencyKey: "k1",
      caller: "public",
      userId: USER,
    });

    expect(result.ok).toBe(true);
    expect(result.credits).toBe(4);

    const after = await counts();
    expect(after.generations).toBe(before.generations + 1);
    expect(after.reservations).toBe(1);
    expect(after.balance).toBe(before.balance - 4);
  });

  it("returns the same generation for the same key and request", async () => {
    const { prepared } = await quote();

    const first = await confirmGeneration({
      token: prepared!.token,
      idempotencyKey: "retry",
      caller: "public",
      userId: USER,
    });

    // A retry of the *same* call. The client did not know the first one
    // landed, which is the only reason idempotency keys exist.
    const second = await confirmGeneration({
      token: prepared!.token,
      idempotencyKey: "retry",
      caller: "public",
      userId: USER,
    });

    expect(second.ok).toBe(true);
    expect(second.replayed).toBe(true);
    expect(second.generationId).toBe(first.generationId);

    const after = await counts();
    expect(after.generations).toBe(1);
    expect(after.reservations).toBe(1);
    expect(after.balance).toBe(996);
  });

  it("refuses the same key carrying a different request", async () => {
    const a = await quote({ prompt: "a lighthouse at dawn" });
    const b = await quote({ prompt: "a completely different picture" });

    await confirmGeneration({
      token: a.prepared!.token,
      idempotencyKey: "shared",
      caller: "public",
      userId: USER,
    });

    const conflict = await confirmGeneration({
      token: b.prepared!.token,
      idempotencyKey: "shared",
      caller: "public",
      userId: USER,
    });

    expect(conflict.ok).toBe(false);
    expect(conflict.reason).toBe("idempotency_conflict");

    // The refusal is free. The second quote is untouched and still spendable.
    expect((await counts()).generations).toBe(1);
    expect((await counts()).balance).toBe(996);
  });

  it("creates one generation when two confirmations arrive together", async () => {
    /**
     * The guarantee that matters most. Two agents retrying at the same instant
     * must not produce two generations or two reservations, and the thing that
     * prevents it is `ON CONFLICT DO NOTHING` waiting for the first writer to
     * commit — not a check in application code.
     */
    const { prepared } = await quote();

    const [first, second] = await Promise.all([
      confirmGeneration({
        token: prepared!.token,
        idempotencyKey: "race",
        caller: "public",
        userId: USER,
      }),
      confirmGeneration({
        token: prepared!.token,
        idempotencyKey: "race",
        caller: "public",
        userId: USER,
      }),
    ]);

    // Both succeed — one by creating, one by replaying. Neither is an error,
    // because from the client's point of view the call worked.
    expect(first.ok && second.ok).toBe(true);
    expect(first.generationId).toBe(second.generationId);
    expect([first.replayed, second.replayed].filter(Boolean)).toHaveLength(1);

    const after = await counts();
    expect(after.generations).toBe(1);
    expect(after.reservations).toBe(1);
    expect(after.balance).toBe(996);
  });

  it("refuses a spent quote presented under a new key", async () => {
    // A fresh idempotency key does not buy a second run of the same quote.
    // The quote is the thing that was paid for, and it is spent.
    const { prepared } = await quote();

    await confirmGeneration({
      token: prepared!.token,
      idempotencyKey: "first",
      caller: "public",
      userId: USER,
    });

    const again = await confirmGeneration({
      token: prepared!.token,
      idempotencyKey: "second",
      caller: "public",
      userId: USER,
    });

    expect(again.ok).toBe(false);
    expect(again.reason).toBe("quote_consumed");
    expect((await counts()).generations).toBe(1);

    // And the refusal left no record behind that would poison the new key.
    const stranded = await client.connectorIdempotency.findMany({
      where: { key: "second" },
    });
    expect(stranded).toHaveLength(0);
  });

  it("keeps two customers' identical keys apart", async () => {
    const mine = await quote({}, USER);
    const theirs = await quote({}, OTHER);

    const a = await confirmGeneration({
      token: mine.prepared!.token,
      idempotencyKey: "1",
      caller: "public",
      userId: USER,
    });
    const b = await confirmGeneration({
      token: theirs.prepared!.token,
      idempotencyKey: "1",
      caller: "public",
      userId: OTHER,
    });

    expect(a.ok && b.ok).toBe(true);
    expect(a.generationId).not.toBe(b.generationId);
    expect((await counts(USER)).generations).toBe(1);
    expect((await counts(OTHER)).generations).toBe(1);
  });

  it("refuses a quote belonging to somebody else", async () => {
    const { prepared } = await quote({}, OTHER);

    const result = await confirmGeneration({
      token: prepared!.token,
      idempotencyKey: "k",
      caller: "public",
      userId: USER,
    });

    expect(result.ok).toBe(false);
    // Not "that is not yours" — one code for every unusable token, so a
    // stolen one cannot be used to learn which half of it was wrong.
    expect(result.reason).toBe("invalid_quote");
    expect((await counts()).generations).toBe(0);
  });

  it("refuses an expired, an altered and an unknown quote", async () => {
    const { prepared } = await quote();

    const expired = await confirmGeneration({
      token: prepared!.token,
      idempotencyKey: "e",
      caller: "public",
      userId: USER,
      nowMs: Date.now() + 3_600_000,
    });
    expect(expired.reason).toBe("quote_expired");

    const [body] = prepared!.token.split(".");
    const altered = await confirmGeneration({
      token: `${body}.forged`,
      idempotencyKey: "t",
      caller: "public",
      userId: USER,
    });
    expect(altered.reason).toBe("invalid_quote");

    // Correctly signed, never recorded: a token from a `prepareGeneration`
    // whose row was not written cannot be confirmed.
    const unrecorded = prepareGeneration(
      { publicModelId: "atheos-image-fast", prompt: "never persisted" },
      "public",
      USER,
    );
    const unknown = await confirmGeneration({
      token: unrecorded.prepared!.token,
      idempotencyKey: "u",
      caller: "public",
      userId: USER,
    });
    expect(unknown.reason).toBe("invalid_quote");

    expect((await counts()).generations).toBe(0);
    expect((await counts()).balance).toBe(1_000);
  });

  it("refuses a model the caller may no longer run, before any money moves", async () => {
    /**
     * Quoted as the owner, confirmed as the public. Motion Pro is
     * owner-evaluation only, so the audience check has to fail at confirmation
     * even though the quote was validly issued — a quote is a price, never a
     * permission.
     */
    const { prepared } = await quote(
      { publicModelId: "motion-pro", durationSeconds: 5 },
      USER,
      "owner",
    );

    const result = await confirmGeneration({
      token: prepared!.token,
      idempotencyKey: "policy",
      caller: "public",
      userId: USER,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("model_unavailable");

    const after = await counts();
    expect(after.generations).toBe(0);
    expect(after.reservations).toBe(0);
    expect(after.balance).toBe(1_000);

    // And the quote is not consumed: the refusal cost the caller nothing.
    const row = await client.connectorQuote.findMany();
    expect(row[0]!.consumedAt).toBeNull();
  });

  it("requires a new quote when the price has moved", async () => {
    const { prepared } = await quote();

    // The registry's price changes between the quote and the confirmation.
    priceMultiplier = 2;

    const result = await confirmGeneration({
      token: prepared!.token,
      idempotencyKey: "price",
      caller: "public",
      userId: USER,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("requote_required");

    const after = await counts();
    expect(after.generations).toBe(0);
    expect(after.balance).toBe(1_000);
    // Neither the old price nor the new one was charged, and the quote
    // survives — though it will fail again until the client asks for a new one.
    expect((await client.connectorQuote.findMany())[0]!.consumedAt).toBeNull();
  });

  it("leaves nothing behind when the credits are not there", async () => {
    /**
     * The rollback the ordering was designed for. Reservation is the last
     * thing inside the transaction, so its failure takes the quote claim, the
     * idempotency record and the generation row with it.
     */
    const { prepared } = await quote({ outputs: 4 });
    await client.user.update({
      where: { id: USER },
      data: { creditBalance: 3 },
    });

    const result = await confirmGeneration({
      token: prepared!.token,
      idempotencyKey: "broke",
      caller: "public",
      userId: USER,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("insufficient_credits");

    expect(await client.generation.count()).toBe(0);
    expect(
      await client.creditTransaction.count({
        where: { reason: "GENERATION_RESERVATION" },
      }),
    ).toBe(0);
    expect(await balanceOf()).toBe(3);

    // The quote is still spendable, and the key is still free. Being briefly
    // short of credits must not cost somebody their quote.
    const row = await client.connectorQuote.findMany();
    expect(row[0]!.consumedAt).toBeNull();
    expect(await client.connectorIdempotency.count()).toBe(0);
  });

  it("stores no token, prompt or provider in the quote row", async () => {
    const { prepared } = await quote({ prompt: "a very distinctive phrase" });

    const rows = await client.connectorQuote.findMany();
    const serialised = JSON.stringify(rows).toLowerCase();

    expect(serialised).not.toContain("distinctive");
    expect(serialised).not.toContain("replicate");
    expect(serialised).not.toContain(
      prepared!.token.slice(0, 24).toLowerCase(),
    );
    expect(rows[0]!.jtiHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keys the row on the token's id and not on the token", async () => {
    // Asserted rather than assumed: the row must be findable from a token the
    // holder presents, and useless to whoever reads the table.
    const { prepared, quoteRecord } = await quote();
    const [body] = prepared!.token.split(".");
    const payload = JSON.parse(
      Buffer.from(body!, "base64url").toString("utf8"),
    ) as { jti: string };

    expect(quoteRecord!.jtiHash).toBe(quoteKeyFor(payload.jti));
    expect(quoteRecord!.jtiHash).not.toContain(payload.jti);
  });
});
