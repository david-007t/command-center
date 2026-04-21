# SPEC.md
# Last updated: 2026-04-15

## Goal

Make Command Center trustworthy enough to manage itself as a first-class project while continuing to evolve into the main operating system for the portfolio.

## Product identity

Command Center is the internal operating system for this AI company. It should track project reality, surface evidence instead of false certainty, and let the CEO work through portfolio and project decisions without leaving the app.

## MVP features — locked

- First-class managed project treatment for `command-center` itself.
- Runtime state, trust summary, investigations, and self-heal flows that work on the app's own repo.
- A persistent system-improvement ledger so CEO feedback on the operating system stays visible and actionable.
- Scout evolution into a daily recommendation engine after the self-management pass is stable.

## Technical approach

- Reuse the existing project runtime, investigation, context-pack, and chat architecture instead of building a separate system-only stack.
- Resolve `command-center` to the workspace root while other projects continue resolving under `DEVELOPER_PATH/<project>`.
- Generate `SYSTEM_IMPROVEMENTS.md` from tracked feedback so self-heal work has a durable governance artifact.
- Treat Command Center system fixes as project work on `command-center` so runtime state and investigations stay unified.

## Acceptance criteria

1. `command-center` appears as a managed project in portfolio and project views even if the external portfolio table is stale.
2. Project pages for `command-center` load from real governance files in this repo root.
3. Runtime state, trust summary, investigations, and run launching all work for `command-center`.
4. System feedback can auto-launch a self-heal run against `command-center` and write the outcome into tracked governance.
5. A durable system-improvement ledger exists and stays aligned with runtime feedback records.

## Assumptions

- The external portfolio file at `/Users/ohsay22/Developer/PORTFOLIO.md` may lag behind repo-local truth, so Command Center should synthesize its own portfolio record when needed.
- Existing project-runtime conventions remain the source of truth; Pass 4 should minimize parallel concepts.
