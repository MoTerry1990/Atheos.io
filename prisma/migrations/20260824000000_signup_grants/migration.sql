-- One signup grant per verified email address, ever.
--
-- No foreign key to "users" on purpose. `credit_transactions` cascades on user
-- delete, so the ledger cannot answer "has this address been granted before"
-- once the account is gone — deleting and re-registering would grant again.
-- This row has to outlive every account the address ever had.
--
-- The address itself is never stored. "emailHash" is a SHA-256 of the
-- normalised address, so the table can refuse a repeat grant without holding a
-- list of everyone who has ever signed up.
CREATE TABLE "signup_grants" (
    "emailHash" TEXT NOT NULL,
    "creditsGranted" INTEGER NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signup_grants_pkey" PRIMARY KEY ("emailHash")
);

CREATE INDEX "signup_grants_grantedAt_idx" ON "signup_grants"("grantedAt");
