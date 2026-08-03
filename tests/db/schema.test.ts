import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The schema's guarantees, against a real Postgres engine.
 *
 * PGlite is Postgres compiled to WebAssembly, running in-process. That means
 * these are not mocks: the migration SQL is applied by an actual Postgres, and
 * a constraint that would not hold in production does not hold here either.
 *
 * What it does **not** cover: the pooler, extensions, and anything about
 * performance. It proves the DDL is valid and the constraints behave.
 *
 * These assertions started life as an ad-hoc script during Sprint 14. Making
 * them a test file is the difference between "we checked once" and "a change
 * that breaks this fails the build".
 */

let db: PGlite;

const MIGRATION = resolve(
  import.meta.dirname,
  "../../prisma/migrations/0_init/migration.sql",
);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(readFileSync(MIGRATION, "utf8"));
}, 60_000);

afterAll(async () => {
  await db?.close();
});

/** Asserts a statement is rejected, and rejected for the expected reason. */
async function rejects(sql: string, because: RegExp) {
  await expect(db.query(sql)).rejects.toThrow(because);
}

const seed = async () => {
  await db.exec(`
    INSERT INTO users ("id","clerkId","email","updatedAt")
    VALUES ('u1','clerk_1','a@example.com',now()),
           ('u2','clerk_2','b@example.com',now());
    INSERT INTO generations ("id","userId","provider","model","modality","prompt")
    VALUES ('g1','u1','mock','mock/x','IMAGE','a cat');
    INSERT INTO assets ("id","userId","generationId","storageKey","mimeType","kind","source","sizeBytes","updatedAt")
    VALUES ('a1','u1','g1','k/1','image/png','IMAGE','GENERATED',1024,now());
  `);
};

describe("migration", () => {
  it("applies cleanly to a real Postgres", async () => {
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.tables
       WHERE table_schema='public' AND table_type='BASE TABLE'`,
    );
    expect(rows[0].n).toBe(16);
  });

  it("creates every enum", async () => {
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(DISTINCT t.typname)::int AS n
       FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid`,
    );
    expect(rows[0].n).toBe(11);
  });

  it("creates every foreign key", async () => {
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.table_constraints
       WHERE constraint_type='FOREIGN KEY' AND table_schema='public'`,
    );
    expect(rows[0].n).toBe(22);
  });
});

describe("idempotency — the guarantees money depends on", () => {
  it("rejects a replayed webhook event id", async () => {
    // This is the single most important constraint in the product. Stripe
    // retries for three days; without this a renewal grants credits twice.
    await db.query(
      `INSERT INTO webhook_events ("id","source","eventType") VALUES ('evt_1','stripe','invoice.paid')`,
    );
    await rejects(
      `INSERT INTO webhook_events ("id","source","eventType") VALUES ('evt_1','stripe','invoice.paid')`,
      /duplicate key/,
    );
  });

  it("rejects a reused credit idempotencyKey", async () => {
    await seed();
    await db.query(
      `INSERT INTO credit_transactions ("id","userId","amount","balanceAfter","reason","idempotencyKey")
       VALUES ('c1','u1',-10,90,'GENERATION_SPEND','refund:g1')`,
    );
    await rejects(
      `INSERT INTO credit_transactions ("id","userId","amount","balanceAfter","reason","idempotencyKey")
       VALUES ('c2','u1',10,100,'GENERATION_REFUND','refund:g1')`,
      /duplicate key/,
    );
  });

  it("allows many rows with a null idempotencyKey", async () => {
    // Ordinary spends carry no key. If null collided, a user could make exactly
    // one generation ever.
    await db.query(
      `INSERT INTO credit_transactions ("id","userId","amount","balanceAfter","reason")
       VALUES ('c3','u1',-5,85,'GENERATION_SPEND')`,
    );
    await expect(
      db.query(
        `INSERT INTO credit_transactions ("id","userId","amount","balanceAfter","reason")
         VALUES ('c4','u1',-5,80,'GENERATION_SPEND')`,
      ),
    ).resolves.toBeDefined();
  });
});

describe("uniqueness", () => {
  it("rejects a duplicate clerkId", async () => {
    await rejects(
      `INSERT INTO users ("id","clerkId","email","updatedAt")
       VALUES ('u9','clerk_1','z@example.com',now())`,
      /duplicate key/,
    );
  });

  it("rejects a duplicate email", async () => {
    await rejects(
      `INSERT INTO users ("id","clerkId","email","updatedAt")
       VALUES ('u9','clerk_9','a@example.com',now())`,
      /duplicate key/,
    );
  });

  it("scopes folder names per user, not globally", async () => {
    await db.query(
      `INSERT INTO folders ("id","userId","name","updatedAt") VALUES ('f1','u1','Work',now())`,
    );
    await rejects(
      `INSERT INTO folders ("id","userId","name","updatedAt") VALUES ('f2','u1','Work',now())`,
      /duplicate key/,
    );
    // The same name for a different person must be fine.
    await expect(
      db.query(
        `INSERT INTO folders ("id","userId","name","updatedAt") VALUES ('f3','u2','Work',now())`,
      ),
    ).resolves.toBeDefined();
  });

  it("makes a double like impossible via the composite primary key", async () => {
    await db.query(
      `INSERT INTO posts ("id","userId","assetId","slug","updatedAt")
       VALUES ('p1','u1','a1','slug-1',now())`,
    );
    await db.query(
      `INSERT INTO post_likes ("postId","userId") VALUES ('p1','u2')`,
    );
    await rejects(
      `INSERT INTO post_likes ("postId","userId") VALUES ('p1','u2')`,
      /duplicate key/,
    );
  });
});

describe("referential integrity", () => {
  it("refuses an asset owned by nobody", async () => {
    await rejects(
      `INSERT INTO assets ("id","userId","storageKey","mimeType","kind","source","sizeBytes","updatedAt")
       VALUES ('a9','ghost','k/9','image/png','IMAGE','GENERATED',10,now())`,
      /foreign key/,
    );
  });

  it("refuses a generation whose lineage parent does not exist", async () => {
    await rejects(
      `INSERT INTO generations ("id","userId","parentId","provider","model","modality","prompt")
       VALUES ('g9','u1','ghost','mock','mock/x','IMAGE','x')`,
      /foreign key/,
    );
  });

  it("resolves both sides of the self-referencing follow relation", async () => {
    await expect(
      db.query(
        `INSERT INTO follows ("followerId","followingId") VALUES ('u1','u2')`,
      ),
    ).resolves.toBeDefined();
  });
});

describe("delete behaviour", () => {
  it("keeps a ledger row when its generation is deleted, nulling the link", async () => {
    // A financial record that vanishes with the thing it paid for is not a
    // ledger. This is what `onDelete: SetNull` is protecting.
    await db.query(
      `INSERT INTO credit_transactions ("id","userId","generationId","amount","balanceAfter","reason")
       VALUES ('c5','u1','g1',-10,70,'GENERATION_SPEND')`,
    );
    await db.query(`DELETE FROM posts WHERE "assetId"='a1'`);
    await db.query(`DELETE FROM assets WHERE "generationId"='g1'`);
    await db.query(`DELETE FROM generations WHERE "id"='g1'`);

    const { rows } = await db.query<{ generationId: string | null }>(
      `SELECT "generationId" FROM credit_transactions WHERE "id"='c5'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].generationId).toBeNull();
  });

  it("cascades a user deletion to everything they own", async () => {
    // Account deletion must not leave orphaned personal data behind.
    await db.query(`DELETE FROM users WHERE "id"='u1'`);

    for (const table of [
      "credit_transactions",
      "generations",
      "assets",
      "folders",
      "collections",
      "posts",
    ]) {
      const { rows } = await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM ${table} WHERE "userId"='u1'`,
      );
      expect(rows[0].n, table).toBe(0);
    }

    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM follows
       WHERE "followerId"='u1' OR "followingId"='u1'`,
    );
    expect(rows[0].n).toBe(0);
  });
});

describe("enums and defaults", () => {
  it("rejects a role outside the enum", async () => {
    await rejects(
      `INSERT INTO users ("id","clerkId","email","role","updatedAt")
       VALUES ('u8','clerk_8','q@example.com','SUPERUSER',now())`,
      /invalid input value for enum/,
    );
  });

  it("defaults a new generation to QUEUED at zero cost", async () => {
    await db.query(
      `INSERT INTO generations ("id","userId","provider","model","modality","prompt")
       VALUES ('g2','u2','mock','mock/x','IMAGE','y')`,
    );
    const { rows } = await db.query<{
      status: string;
      creditsCost: number;
      operation: string;
    }>(
      `SELECT "status","creditsCost","operation" FROM generations WHERE "id"='g2'`,
    );

    expect(rows[0].status).toBe("QUEUED");
    expect(rows[0].creditsCost).toBe(0);
    expect(rows[0].operation).toBe("TEXT_TO_IMAGE");
  });
});

describe("the daily-series aggregation", () => {
  it("buckets by UTC day exactly as dayKey does", async () => {
    // Sprint 16 moved this from a JavaScript loop into `date_trunc`. The two
    // must agree: `dayKey` is toISOString().slice(0,10), and the column is a
    // timestamp without a zone, so neither side converts.
    await db.exec(`
      INSERT INTO users ("id","clerkId","email","createdAt","updatedAt")
      VALUES ('s1','cs1','s1@e.com','2026-07-30 12:00:00','2026-07-30 12:00:00');
      INSERT INTO generations ("id","userId","provider","model","modality","prompt","createdAt")
      VALUES ('x1','s1','mock','m','IMAGE','p','2026-07-30 01:00:00'),
             ('x2','s1','mock','m','IMAGE','p','2026-07-30 23:59:59'),
             ('x3','s1','mock','m','IMAGE','p','2026-07-31 00:00:01');
    `);

    const { rows } = await db.query<{ day: Date; n: bigint }>(
      `SELECT date_trunc('day', "createdAt") AS day, count(*) AS n
       FROM generations WHERE "createdAt" >= '2026-07-30 00:00:00'
       GROUP BY 1 ORDER BY 1`,
    );

    const dayKey = (d: Date) => new Date(d).toISOString().slice(0, 10);
    const got = Object.fromEntries(
      rows.map((r) => [dayKey(r.day), Number(r.n)]),
    );

    // Two on the 30th including one a second before midnight, one on the 31st.
    expect(got["2026-07-30"]).toBe(2);
    expect(got["2026-07-31"]).toBe(1);
  });
});
