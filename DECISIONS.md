# DECISIONS.md
# Last updated: 2026-04-15

## Decision log

- 2026-04-15 — Pass 4 will use the existing project runtime architecture instead of creating a parallel system-only management layer.
- 2026-04-15 — `command-center` should resolve to the repo root and synthesize a portfolio record if the external portfolio file is stale.
- 2026-04-15 — System feedback on Command Center should auto-launch project-native self-heal work against `command-center` so runtime state and trust stay unified.

## Dependency log

- `_system/runtime` remains the shared runtime source for jobs, messages, commentaries, context packs, investigations, and usage.
- `/Users/ohsay22/Developer/PORTFOLIO.md` remains an important but not perfectly fresh external portfolio input.
