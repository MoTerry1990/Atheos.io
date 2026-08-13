-- Two additional plan tiers: BASIC ("Starter", $5) and AGENCY ("Agency", $199).
--
-- Purely additive. No existing row changes tier, no default changes, and no
-- column is rewritten — adding a label to an enum does not touch the heap.
--
-- The existing labels are deliberately NOT renamed. STARTER already means the
-- free plan and STUDIO already means "Creator"; renaming them to match the new
-- display names would rewrite the meaning of every stored subscription row for
-- the sake of tidiness. The mapping is documented in schema.prisma.
--
-- `ADD VALUE` inside a transaction requires PostgreSQL 12 or later, which
-- Supabase satisfies. The new labels are not referenced anywhere else in this
-- migration, which is the other constraint.

ALTER TYPE "PlanTier" ADD VALUE IF NOT EXISTS 'BASIC' AFTER 'STARTER';
ALTER TYPE "PlanTier" ADD VALUE IF NOT EXISTS 'AGENCY' AFTER 'SCALE';
