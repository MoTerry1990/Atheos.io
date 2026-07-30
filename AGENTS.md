# Agent rules

This project runs **Next.js 15.5 with the App Router**.

It was scaffolded with `create-next-app@latest`, which installed Next 16, and was
then deliberately pinned back to 15 — see [`docs/DECISIONS.md`](docs/DECISIONS.md).
Two consequences worth knowing before writing code:

- The Next 16 agent rules `create-next-app` writes into this file by default do
  not apply and have been removed. In particular there is no
  `node_modules/next/dist/docs/` directory on the 15.x line.
- `eslint-config-next@15` ships legacy eslintrc configs with no exports map, so
  `eslint.config.mjs` loads them through `FlatCompat`. That is expected, not a
  workaround to tidy away.

Working agreements, architecture boundaries and the definition of done are in
[`CLAUDE.md`](CLAUDE.md).
