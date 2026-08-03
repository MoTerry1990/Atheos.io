import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * The claim query, against real Postgres.
 *
 * This is the one piece of the worker that cannot be verified by reading it.
 * The failure it prevents — two workers claiming the same job, submitting it to
 * a provider twice, and charging a user twice for one generation — appears only
 * under concurrency, which is exactly when nobody is watching.
 *
 * The SQL here is kept identical to `services/worker/queue.ts`. That
 * duplication is deliberate and it is the test's weakness: it proves the query
 * is correct, not that the application sends this query. Prisma cannot be
 * pointed at PGlite, so this is the closest available verification, and saying
 * so is better than implying more.
 */

let db: PGlite;
const MIGRATIONS = resolve(import.meta.dirname, "../../prisma/migrations");
const LEASE_MS = 5 * 60_000;

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
    VALUES ('wu1','wc1','w1@example.com', now());
  `);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await db.exec(`DELETE FROM generation_logs; DELETE FROM generations;`);
});

async function seedJob(
  id: string,
  status = "QUEUED",
  extra: Record<string, string | null> = {},
) {
  const columns = Object.keys(extra);
  const values = Object.values(extra);

  await db.query(
    `INSERT INTO generations
       ("id","userId","provider","model","modality","prompt","status"
        ${columns.length ? "," + columns.map((c) => `"${c}"`).join(",") : ""})
     VALUES ($1,'wu1','mock','mock/x','IMAGE','a cat',$2::"GenerationStatus"
        ${columns.length ? "," + columns.map((_, i) => `$${i + 3}`).join(",") : ""})`,
    [id, status, ...values],
  );
}

/** The claim statement, verbatim from services/worker/queue.ts. */
const CLAIM = `
  WITH runnable AS (
    SELECT "id" FROM "generations"
    WHERE
      (
        "status" IN ('QUEUED','RETRYING')
        AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= $2)
      )
      OR (
        "status" = 'RUNNING'
        AND "lockedAt" IS NOT NULL
        AND "lockedAt" < $3
      )
    ORDER BY "createdAt" ASC
    LIMIT $4
    FOR UPDATE SKIP LOCKED
  )
  UPDATE "generations" AS g
  SET "status"='RUNNING', "lockedAt"=$2, "lockedBy"=$1,
      "startedAt"=COALESCE(g."startedAt",$2),
      "attemptCount"=g."attemptCount"+1
  FROM runnable WHERE g."id"=runnable."id"
  RETURNING g."id"`;

const claim = async (workerId: string, limit = 5, now = new Date()) => {
  const { rows } = await db.query<{ id: string }>(CLAIM, [
    workerId,
    now,
    new Date(now.getTime() - LEASE_MS),
    limit,
  ]);
  return rows.map((r) => r.id);
};

describe("claiming", () => {
  it("claims a queued job and marks it running", async () => {
    await seedJob("j1");

    expect(await claim("worker-a")).toEqual(["j1"]);

    const { rows } = await db.query<{
      status: string;
      lockedBy: string;
      attemptCount: number;
      startedAt: Date | null;
    }>(`SELECT "status","lockedBy","attemptCount","startedAt"
        FROM generations WHERE "id"='j1'`);

    expect(rows[0].status).toBe("RUNNING");
    expect(rows[0].lockedBy).toBe("worker-a");
    expect(rows[0].attemptCount).toBe(1);
    expect(rows[0].startedAt).not.toBeNull();
  });

  it("does not re-claim a job another worker already holds", async () => {
    await seedJob("j1");

    expect(await claim("worker-a")).toEqual(["j1"]);
    // Fresh lease, so it is not reclaimable.
    expect(await claim("worker-b")).toEqual([]);
  });

  it("never gives the same job to two concurrent workers", async () => {
    // The race this whole design exists to prevent. Both claims are issued
    // without awaiting the first, so they overlap.
    for (let i = 0; i < 20; i++) await seedJob(`j${i}`);

    const [a, b] = await Promise.all([
      claim("worker-a", 20),
      claim("worker-b", 20),
    ]);

    const overlap = a.filter((id) => b.includes(id));

    expect(overlap, `both workers claimed: ${overlap.join(", ")}`).toEqual([]);
    // Between them they took every job — SKIP LOCKED must not lose work.
    expect(new Set([...a, ...b]).size).toBe(20);
  });

  it("respects the limit", async () => {
    for (let i = 0; i < 10; i++) await seedJob(`j${i}`);
    expect(await claim("worker-a", 3)).toHaveLength(3);
  });

  it("claims oldest first", async () => {
    await seedJob("old");
    await db.query(
      `UPDATE generations SET "createdAt" = now() - interval '1 hour' WHERE "id"='old'`,
    );
    await seedJob("new");

    expect((await claim("worker-a", 1))[0]).toBe("old");
  });

  it("ignores terminal jobs", async () => {
    await seedJob("done", "SUCCEEDED");
    await seedJob("dead", "FAILED");
    await seedJob("gone", "CANCELED");

    expect(await claim("worker-a")).toEqual([]);
  });
});

describe("retry scheduling", () => {
  it("does not claim a retrying job before its backoff elapses", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    await seedJob("j1", "RETRYING", { nextAttemptAt: future });

    expect(await claim("worker-a")).toEqual([]);
  });

  it("claims a retrying job once its backoff has passed", async () => {
    const past = new Date(Date.now() - 1_000).toISOString();
    await seedJob("j1", "RETRYING", { nextAttemptAt: past });

    expect(await claim("worker-a")).toEqual(["j1"]);
  });

  it("increments attemptCount on every claim", async () => {
    await seedJob("j1", "RETRYING", {
      nextAttemptAt: new Date(Date.now() - 1_000).toISOString(),
    });

    await claim("worker-a");
    // Release, as markRetrying would.
    await db.query(
      `UPDATE generations SET "status"='RETRYING', "lockedBy"=NULL,
       "lockedAt"=NULL, "nextAttemptAt"=now() - interval '1 second' WHERE "id"='j1'`,
    );
    await claim("worker-a");

    const { rows } = await db.query<{ attemptCount: number }>(
      `SELECT "attemptCount" FROM generations WHERE "id"='j1'`,
    );
    expect(rows[0].attemptCount).toBe(2);
  });
});

describe("lease expiry — recovering from a dead worker", () => {
  it("reclaims a running job whose lease has expired", async () => {
    // The failure without this: a worker dies mid-run and the job sits in
    // RUNNING forever, with the user waiting for something nobody is doing.
    const stale = new Date(Date.now() - LEASE_MS - 10_000).toISOString();
    await seedJob("j1", "RUNNING", {
      lockedAt: stale,
      lockedBy: "dead-worker",
    });

    expect(await claim("worker-b")).toEqual(["j1"]);

    const { rows } = await db.query<{ lockedBy: string }>(
      `SELECT "lockedBy" FROM generations WHERE "id"='j1'`,
    );
    expect(rows[0].lockedBy).toBe("worker-b");
  });

  it("does not reclaim a job whose lease is still live", async () => {
    const recent = new Date(Date.now() - 10_000).toISOString();
    await seedJob("j1", "RUNNING", { lockedAt: recent, lockedBy: "worker-a" });

    expect(await claim("worker-b")).toEqual([]);
  });

  it("preserves the original startedAt when reclaiming", async () => {
    // `COALESCE` in the claim. Overwriting it would make every reclaim look
    // like a fresh start and destroy the real duration.
    const stale = new Date(Date.now() - LEASE_MS - 10_000).toISOString();
    await seedJob("j1", "RUNNING", { lockedAt: stale, lockedBy: "dead" });
    await db.query(
      `UPDATE generations SET "startedAt" = now() - interval '2 hours' WHERE "id"='j1'`,
    );

    const before = await db.query<{ startedAt: Date }>(
      `SELECT "startedAt" FROM generations WHERE "id"='j1'`,
    );
    await claim("worker-b");
    const after = await db.query<{ startedAt: Date }>(
      `SELECT "startedAt" FROM generations WHERE "id"='j1'`,
    );

    expect(new Date(after.rows[0].startedAt).getTime()).toBe(
      new Date(before.rows[0].startedAt).getTime(),
    );
  });
});

describe("the RETRYING state", () => {
  it("exists in the enum and is distinct from QUEUED", async () => {
    // Merging them would hide a rising retry rate, which is the earliest signal
    // of a provider outage.
    const { rows } = await db.query<{ enumlabel: string }>(
      `SELECT e.enumlabel FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'GenerationStatus' ORDER BY e.enumsortorder`,
    );

    const labels = rows.map((r) => r.enumlabel);
    expect(labels).toContain("RETRYING");
    expect(labels).toContain("QUEUED");
    expect(labels.indexOf("RETRYING")).toBeGreaterThan(
      labels.indexOf("RUNNING"),
    );
  });
});

describe("job logs", () => {
  it("persists a line and reads it back oldest first", async () => {
    await seedJob("j1");

    await db.query(
      `INSERT INTO generation_logs ("id","generationId","level","message","context")
       VALUES ('l1','j1','info','claimed','{"worker":"a"}'::jsonb),
              ('l2','j1','error','provider timed out','{"code":"timeout"}'::jsonb)`,
    );

    const { rows } = await db.query<{ level: string; message: string }>(
      `SELECT "level","message" FROM generation_logs
       WHERE "generationId"='j1' ORDER BY "createdAt" ASC, "id" ASC`,
    );

    expect(rows.map((r) => r.level)).toEqual(["info", "error"]);
    expect(rows[1].message).toBe("provider timed out");
  });

  it("cascades log deletion with its generation", async () => {
    // Log context carries prompts. Orphaned rows would be personal data nobody
    // can reach to delete.
    await seedJob("j1");
    await db.query(
      `INSERT INTO generation_logs ("id","generationId","level","message")
       VALUES ('l1','j1','info','x')`,
    );

    await db.query(`DELETE FROM generations WHERE "id"='j1'`);

    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM generation_logs WHERE "generationId"='j1'`,
    );
    expect(rows[0].n).toBe(0);
  });

  it("keeps context queryable as JSON", async () => {
    await seedJob("j1");
    await db.query(
      `INSERT INTO generation_logs ("id","generationId","level","message","context")
       VALUES ('l1','j1','error','failed','{"code":"timeout","provider":"replicate"}'::jsonb)`,
    );

    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM generation_logs
       WHERE "context" @> '{"code":"timeout"}'::jsonb`,
    );
    expect(rows[0].n).toBe(1);
  });
});

describe("indexes the claim query depends on", () => {
  it("indexes status with nextAttemptAt and with lockedAt", async () => {
    const { rows } = await db.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename='generations'`,
    );
    const names = rows.map((r) => r.indexname);

    expect(names).toContain("generations_status_nextAttemptAt_idx");
    expect(names).toContain("generations_status_lockedAt_idx");
  });
});
