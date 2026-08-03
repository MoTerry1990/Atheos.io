import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * The usage aggregation, against real Postgres.
 *
 * A billing report is the kind of code that is wrong quietly. It returns a
 * number either way, and the number looks plausible either way — so the
 * failures worth testing are the ones that produce a *believable* wrong answer:
 *
 *   - counting a refunded generation as usage (double-counts a refund);
 *   - summing an unknown cost as zero (makes an unpriced model look free);
 *   - reporting a margin from partial cost data (flatters the number).
 *
 * As in the worker tests, the SQL is kept identical to the service and that
 * duplication is the weakness: this proves the query is right, not that the
 * application sends it. Prisma cannot be pointed at PGlite.
 */

let db: PGlite;
const MIGRATIONS = resolve(import.meta.dirname, "../../prisma/migrations");

beforeAll(async () => {
  db = new PGlite();
  for (const name of readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()) {
    await db.exec(
      readFileSync(resolve(MIGRATIONS, name, "migration.sql"), "utf8"),
    );
  }

  await db.exec(`
    INSERT INTO users ("id","clerkId","email","updatedAt")
    VALUES ('u1','c1','u1@e.com',now()),
           ('u2','c2','u2@e.com',now());
  `);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await db.exec(`DELETE FROM generation_logs; DELETE FROM generations;`);
});

interface Job {
  id: string;
  userId?: string;
  status?: string;
  createdAt?: string;
  credits?: number;
  cost?: number | null;
  images?: number | null;
  video?: number | null;
  audio?: number | null;
  gpu?: number | null;
  promptTokens?: number | null;
}

async function seed(job: Job) {
  await db.query(
    `INSERT INTO generations
       ("id","userId","provider","model","modality","prompt","status","createdAt",
        "creditsCost","costMicroUsd","imageCount","videoSeconds","audioSeconds",
        "gpuTimeMs","promptTokens")
     VALUES ($1,$2,'mock','mock/x','IMAGE','p',$3::"GenerationStatus",$4,
             $5,$6,$7,$8,$9,$10,$11)`,
    [
      job.id,
      job.userId ?? "u1",
      job.status ?? "SUCCEEDED",
      job.createdAt ?? "2026-08-02 12:00:00",
      job.credits ?? 0,
      job.cost ?? null,
      job.images ?? null,
      job.video ?? null,
      job.audio ?? null,
      job.gpu ?? null,
      job.promptTokens ?? null,
    ],
  );
}

/** The totals aggregate, verbatim from services/billing/usage.ts. */
const TOTALS = `
  SELECT
    COALESCE(SUM("creditsCost"), 0)      AS credits,
    SUM("costMicroUsd")                  AS cost,
    COUNT("costMicroUsd")                AS costed,
    COUNT(*)                             AS total,
    COALESCE(SUM("imageCount"), 0)       AS images,
    COALESCE(SUM("videoSeconds"), 0)     AS video,
    COALESCE(SUM("audioSeconds"), 0)     AS audio,
    COALESCE(SUM("gpuTimeMs"), 0)        AS gpu,
    COALESCE(SUM("promptTokens"), 0)     AS prompt_tokens
  FROM "generations"
  WHERE "userId" = ANY($1) AND "status" = 'SUCCEEDED'
    AND "createdAt" >= $2 AND "createdAt" < $3`;

const totals = async (
  userIds: string[],
  from = "2026-08-01",
  to = "2026-09-01",
) => {
  const { rows } = await db.query<Record<string, bigint | null>>(TOTALS, [
    userIds,
    from,
    to,
  ]);
  return rows[0];
};

describe("what counts as usage", () => {
  it("counts succeeded generations", async () => {
    await seed({ id: "g1", credits: 10, cost: 3_000, images: 1 });
    const t = await totals(["u1"]);

    expect(Number(t.credits)).toBe(10);
    expect(Number(t.cost)).toBe(3_000);
    expect(Number(t.total)).toBe(1);
  });

  it("excludes failed and cancelled generations", async () => {
    // A failed job was refunded. Counting it as usage double-counts a refund
    // the ledger already made.
    await seed({ id: "ok", credits: 10, cost: 3_000 });
    await seed({ id: "bad", status: "FAILED", credits: 10, cost: 3_000 });
    await seed({ id: "gone", status: "CANCELED", credits: 10, cost: 3_000 });

    const t = await totals(["u1"]);
    expect(Number(t.credits)).toBe(10);
    expect(Number(t.total)).toBe(1);
  });

  it("excludes running and retrying jobs", async () => {
    await seed({ id: "run", status: "RUNNING", credits: 10 });
    await seed({ id: "retry", status: "RETRYING", credits: 10 });

    expect(Number((await totals(["u1"])).total)).toBe(0);
  });

  it("scopes to the users asked for", async () => {
    await seed({ id: "a", userId: "u1", credits: 10 });
    await seed({ id: "b", userId: "u2", credits: 99 });

    expect(Number((await totals(["u1"])).credits)).toBe(10);
    expect(Number((await totals(["u2"])).credits)).toBe(99);
    // Set-based, which is what makes organisation rollup work.
    expect(Number((await totals(["u1", "u2"])).credits)).toBe(109);
  });

  it("respects the period boundaries, half-open", async () => {
    await seed({ id: "before", createdAt: "2026-07-31 23:59:59", credits: 1 });
    await seed({ id: "start", createdAt: "2026-08-01 00:00:00", credits: 2 });
    await seed({ id: "end", createdAt: "2026-08-31 23:59:59", credits: 4 });
    await seed({ id: "after", createdAt: "2026-09-01 00:00:00", credits: 8 });

    // `>= from AND < to` — an inclusive upper bound would count September's
    // first moment in August and again in September.
    expect(Number((await totals(["u1"])).credits)).toBe(6);
  });
});

describe("unknown cost is null, never zero", () => {
  it("returns null when nothing in the period is priced", async () => {
    await seed({ id: "g1", credits: 10, cost: null });

    const t = await totals(["u1"]);
    expect(t.cost).toBeNull();
    expect(Number(t.costed)).toBe(0);
    expect(Number(t.total)).toBe(1);
  });

  it("sums only the priced rows, and reports how many those were", async () => {
    // The number that stops a partial cost being read as a complete one.
    await seed({ id: "priced", credits: 5, cost: 3_000 });
    await seed({ id: "unpriced", credits: 5, cost: null });

    const t = await totals(["u1"]);
    expect(Number(t.cost)).toBe(3_000);
    expect(Number(t.costed)).toBe(1);
    expect(Number(t.total)).toBe(2);
  });

  it("does not let COUNT(column) drift into COUNT(*)", async () => {
    // `COUNT("costMicroUsd")` skips nulls; `COUNT(*)` does not. Swapping them
    // would silently claim every generation was priced.
    await seed({ id: "a", cost: null });
    await seed({ id: "b", cost: null });
    await seed({ id: "c", cost: 1_000 });

    const t = await totals(["u1"]);
    expect(Number(t.costed)).toBe(1);
    expect(Number(t.total)).toBe(3);
  });
});

describe("units of work", () => {
  it("sums each unit independently", async () => {
    await seed({ id: "img", images: 4, credits: 16 });
    await seed({ id: "vid", video: 10, credits: 90 });
    await seed({ id: "gpu", gpu: 2_500, promptTokens: 1_200 });

    const t = await totals(["u1"]);
    expect(Number(t.images)).toBe(4);
    expect(Number(t.video)).toBe(10);
    expect(Number(t.gpu)).toBe(2_500);
    expect(Number(t.prompt_tokens)).toBe(1_200);
  });

  it("treats a null unit as absent, not as zero contribution", async () => {
    // A video job has no image count. Both read as 0 in the sum — the point is
    // that the *column* stays null so "no images" and "not an image job" remain
    // distinguishable on the row itself.
    await seed({ id: "vid", video: 5, images: null });

    const { rows } = await db.query<{ imageCount: number | null }>(
      `SELECT "imageCount" FROM generations WHERE "id"='vid'`,
    );
    expect(rows[0].imageCount).toBeNull();

    const t = await totals(["u1"]);
    expect(Number(t.images)).toBe(0);
    expect(Number(t.video)).toBe(5);
  });
});

describe("daily and monthly bucketing", () => {
  it("buckets by UTC day", async () => {
    await seed({ id: "a", createdAt: "2026-08-02 01:00:00", credits: 1 });
    await seed({ id: "b", createdAt: "2026-08-02 23:59:59", credits: 2 });
    await seed({ id: "c", createdAt: "2026-08-03 00:00:01", credits: 4 });

    const { rows } = await db.query<{ bucket: Date; credits: bigint }>(
      `SELECT date_trunc('day', "createdAt") AS bucket,
              COALESCE(SUM("creditsCost"),0) AS credits
       FROM generations WHERE "status"='SUCCEEDED'
       GROUP BY 1 ORDER BY 1`,
    );

    const byDay = Object.fromEntries(
      rows.map((r) => [
        new Date(r.bucket).toISOString().slice(0, 10),
        Number(r.credits),
      ]),
    );

    expect(byDay["2026-08-02"]).toBe(3);
    expect(byDay["2026-08-03"]).toBe(4);
  });

  it("buckets by month across a boundary", async () => {
    await seed({ id: "jul", createdAt: "2026-07-15 12:00:00", credits: 5 });
    await seed({ id: "aug", createdAt: "2026-08-15 12:00:00", credits: 7 });

    const { rows } = await db.query<{ bucket: Date; credits: bigint }>(
      `SELECT date_trunc('month', "createdAt") AS bucket,
              COALESCE(SUM("creditsCost"),0) AS credits
       FROM generations WHERE "status"='SUCCEEDED'
       GROUP BY 1 ORDER BY 1`,
    );

    const byMonth = Object.fromEntries(
      rows.map((r) => [
        new Date(r.bucket).toISOString().slice(0, 7),
        Number(r.credits),
      ]),
    );

    expect(byMonth["2026-07"]).toBe(5);
    expect(byMonth["2026-08"]).toBe(7);
  });

  it("returns no row for a day with no activity", async () => {
    // Which is why the service zero-fills: a chart drawn from sparse rows
    // rescales its x-axis and makes a quiet week look like a busy one.
    await seed({ id: "a", createdAt: "2026-08-02 12:00:00" });

    const { rows } = await db.query(
      `SELECT date_trunc('day',"createdAt") AS bucket FROM generations
       WHERE "status"='SUCCEEDED' GROUP BY 1`,
    );
    expect(rows).toHaveLength(1);
  });
});

describe("cost by provider", () => {
  it("groups spend by vendor, unpriced vendors last", async () => {
    await db.query(
      `INSERT INTO generations ("id","userId","provider","model","modality","prompt","status","costMicroUsd")
       VALUES ('a','u1','replicate','m','IMAGE','p','SUCCEEDED',5000),
              ('b','u1','replicate','m','IMAGE','p','SUCCEEDED',3000),
              ('c','u1','openai','m','IMAGE','p','SUCCEEDED',40000),
              ('d','u1','mystery','m','IMAGE','p','SUCCEEDED',NULL)`,
    );

    const { rows } = await db.query<{
      provider: string;
      cost: bigint | null;
      total: bigint;
    }>(
      `SELECT "provider", SUM("costMicroUsd") AS cost, COUNT(*) AS total
       FROM generations WHERE "status"='SUCCEEDED'
       GROUP BY "provider" ORDER BY SUM("costMicroUsd") DESC NULLS LAST`,
    );

    expect(rows[0].provider).toBe("openai");
    expect(Number(rows[0].cost)).toBe(40_000);
    expect(rows[1].provider).toBe("replicate");
    expect(Number(rows[1].cost)).toBe(8_000);
    // NULLS LAST — an unpriced vendor must not sort as the cheapest.
    expect(rows[2].provider).toBe("mystery");
    expect(rows[2].cost).toBeNull();
  });
});

describe("the reporting index", () => {
  it("exists for per-user usage over a period", async () => {
    const { rows } = await db.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename='generations'`,
    );
    expect(rows.map((r) => r.indexname)).toContain(
      "generations_userId_status_createdAt_idx",
    );
  });
});
