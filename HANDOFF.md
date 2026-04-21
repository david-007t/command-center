# HANDOFF.md
# Session date: 2026-04-21

## Current product direction

Command Center is pivoting to an execution-first MVP. Do not spend more time trying to make project chat feel natural in v1.

The CEO wants the product to support parallel development across multiple projects by Monday morning with the smallest reliable surface area:

- Status update
- Decision capture
- Execution trigger
- Persistent execution status window
- Development -> test -> sign off -> freeze per feature

The core principle is now: conversation is not the workflow. Execution is the workflow.

Chat can come back later as v2/v3, but it should not block the MVP. The UI should behave more like a project operations console than a chat product.

## Why this pivot happened

Project chat became brittle because it depended on deterministic intent routing and exact-ish phrase matching. Leadqual exposed the failure most visibly, but the issue is systemic: generic follow-ups like "ok proceed", "proceed", "keep going", and other approval/continue language could miss local handlers, fall through to the slow Claude path, and timeout.

Several narrow fixes were made before the pivot:

- Worker queue pickup was restored by running the local Inngest dev runner.
- Global notifications were added, then partially suppressed in project chat.
- Blank chat replies were replaced with visible fallback errors/timeouts.
- Decision summary questions got a local fast path.
- Decision explanation questions got a separate local fast path.
- Leadqual scope decisions like "make it single user" got a local decision-recording path.
- A brittle guard was removed so "make it single user" no longer required `projectStatus.ceoDecision` to be present.
- The exact angry single-user confirmation path was verified live against `/api/chat`.

But generic approval/follow-up language still escaped the fast paths. The deeper problem was not one missing regex. It was that the chat route was acting as product UX, workflow router, decision engine, and execution trigger all at once.

## What changed in the app

Chat has been frozen for MVP and mostly removed from the visible UI:

- `/chat` redirects to `/projects`.
- `/projects/[name]/chat` redirects to `/projects/[name]/work`.
- The sidebar no longer shows `Chat`.
- Project cards no longer show `Open chat`.
- Project detail defaults to the work view.
- The work view copy says chat is frozen for MVP.

The current visible product surface should be:

- `/projects`
- `/projects/[name]/overview`
- `/projects/[name]/work`
- `/projects/[name]/log`

If chat links or chat pages appear again, check for stale server/build state first, then check:

- `app/layout.tsx`
- `app/chat/page.tsx`
- `app/projects/page.tsx`
- `app/projects/[name]/page.tsx`
- `app/projects/[name]/chat/page.tsx`
- `components/project-operator.tsx`

## What works right now

The work page already has several pieces needed for the MVP:

- Project status and health load through `lib/project-page-data.ts`.
- Project data can come from Supabase-backed runtime store when configured.
- Governance tabs load from repo files such as `SPEC.md`, `TASKS.md`, `HANDOFF.md`, `ERRORS.md`, `DECISIONS.md`, `QA_CHECKLIST.md`, and `SECURITY_CHECKLIST.md`.
- Worker runner health is detected by `lib/dev-runner-health.ts`.
- `components/project-operator.tsx` shows `Worker runner online` or `Worker runner offline`.
- New run launch buttons are disabled or warned when the runner is unavailable.
- Active runs show current stage, commentary preview, and queue/offline warnings.
- `/api/runs` launches, lists, cancels, and retries project task runs.
- Run records, run steps, events, artifacts, and messages have Supabase-backed persistence paths.
- Execution state survives tab changes because runtime state is persisted outside the React component.

The local server was previously started on `http://localhost:3010` with `INNGEST_DEV=1`, and the Inngest dev runner had been started with:

```bash
npx inngest-cli@latest dev -u http://127.0.0.1:3010/api/inngest
```

If queued jobs do not move, first check whether the Inngest dev runner is alive. A queued job with `Worker runner offline` means no active consumer is picking up work.

## What is not true yet

Be explicit about this in the next session.

Supabase is being used for runtime persistence, not yet for vectorized memory retrieval.

Current Supabase-backed areas include project/runtime state, runs, run steps, artifacts, threads/messages/events, and realtime-ish sync. Relevant files include:

- `lib/runtime-store/phase1-store.ts`
- `lib/inngest-run-store.ts`
- `lib/runtime-sync.ts`
- `lib/runtime-events.ts`
- `lib/chat-thread-store.ts`

The system still reads a lot of project governance/context from markdown files:

- `TASKS.md`
- `HANDOFF.md`
- `ERRORS.md`
- `DECISIONS.md`
- `QA_CHECKLIST.md`
- `SECURITY_CHECKLIST.md`
- `SPEC.md`

There is not currently an embedding/vector-search memory layer doing semantic retrieval from Supabase. If the next agent claims otherwise, verify it in code first.

## Target MVP workflow

Replace chat-as-control-plane with structured work orders.

The simplest execution flow should be:

1. Select project.
2. Click `Start Work`.
3. Fill a structured work order instead of typing into chat.
4. Launch worker.
5. Watch persistent execution window.
6. Review output and verification.
7. Sign off or send back.
8. Freeze the feature when accepted.

The minimum work-order fields should be:

- Title
- Change requested
- Why this matters
- Acceptance criteria
- Verification plan
- Phase: development, test, sign-off, or freeze
- Run type/template: continue, blocker, review, QA, investigate, or custom

Avoid conversational routing. The structured form should create a clear instruction for `/api/runs`, then the worker should execute.

## Recommended next implementation

Make the narrowest product move: convert the existing freeform launch area in `components/project-operator.tsx` into a structured `Start Work` panel.

Reuse the existing backend first:

- Keep `/api/runs` as the launch path.
- Keep `launchJob(...)` and `buildProjectRunSpec(...)`.
- Compile structured work-order fields into one deterministic instruction string.
- Store the launched run normally.
- Show the compiled assignment, active run status, commentary preview, and final evidence in the work page.

Do not build a full new work-item database model until the form-to-run path is stable. If a durable work-item entity is needed, add it after the MVP flow works end to end.

The next state model should be:

```text
Backlog -> Developing -> Testing -> Needs Sign-Off -> Frozen
```

For the first pass, it is acceptable to encode this in run metadata/instruction text and UI labels. A dedicated table can come later.

## Files to inspect first

Start here:

- `components/project-operator.tsx`
- `app/api/runs/route.ts`
- `lib/orchestration.ts`
- `lib/project-status.ts`
- `lib/project-page-data.ts`
- `lib/inngest-run-store.ts`
- `lib/runtime-store/phase1-store.ts`
- `lib/dev-runner-health.ts`

Then inspect the current route redirects:

- `app/chat/page.tsx`
- `app/projects/[name]/chat/page.tsx`
- `app/projects/[name]/page.tsx`

## Verification to run

After editing, run:

```bash
npm run build
```

Also run the focused tests that existed after the chat-freeze work:

```bash
node --test lib/dev-runner-health.test.ts lib/project-chat-core.test.ts lib/project-chat-actions.test.ts lib/project-chat-status.test.ts lib/project-chat-launch.test.ts lib/project-chat-investigation.test.ts
```

If the build fails with `ENOSPC`, clear `.next` and rebuild:

```bash
rm -rf /Users/ohsay22/Developer/command-center/.next
npm run build
```

If the UI looks stale after a successful build, restart the server on port `3010`.

## What not to do next

Do not start new feature work outside the execution-first MVP.

Do not revive the chat UI.

Do not spend another cycle patching exact chat phrases unless the CEO explicitly asks to bring chat back.

Do not claim vector memory exists unless an embedding/vector retrieval implementation is present and verified.

Do not claim queued work is running unless the runner is online and the run has moved beyond `queued`.

## Suggested next-session opening move

Say plainly:

"Command Center is now in execution-first MVP mode. Chat is frozen. I am going to replace the remaining freeform launch UX with a structured Start Work form that launches the existing worker path and preserves the execution window."

Then inspect the files listed above and implement the structured work-order launch panel.
