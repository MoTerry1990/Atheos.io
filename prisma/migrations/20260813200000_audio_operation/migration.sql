-- Audio generation. Additive: a new label on an existing enum touches no rows.
ALTER TYPE "GenerationOperation" ADD VALUE IF NOT EXISTS 'TEXT_TO_AUDIO';
