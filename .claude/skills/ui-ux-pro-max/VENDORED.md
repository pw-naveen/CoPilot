# Vendored skill

`ui-ux-pro-max` is third-party, copied in rather than installed through its CLI
so nothing global was added and no install script ran.

- Source: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
- Version: 2.13.0 (commit 1a2c459)
- Licence: MIT, Copyright (c) 2024 Next Level Builder

It is committed so cloud sessions, which clone the repository fresh, have it
without a setup step.

To update, re-copy `.claude/skills/ui-ux-pro-max` from a newer checkout of the
upstream repository, or run `npx ui-ux-pro-max-cli init --ai claude` and review
the diff.

Its `scripts/` are an offline search over the CSV files in `data/`; they make no
network calls and shell out to nothing.
