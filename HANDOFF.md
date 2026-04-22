# HANDOFF.md
# Session date: 2026-04-21

## Latest State For Next Codex Chat

### Current Product Direction

Command Center has proven its first real end-to-end execution loop with **LeadQual**:

```text
CEO gives vague product feedback -> Command Center creates an approval-gated plan -> worker runs in the real project repo -> code changes land -> product deploys -> Command Center shows what changed and what to test.
```

That proof is enough to pause LeadQual product work and focus on Command Center itself.

The new goal is to turn Command Center into the operating desk for all projects:

- show every project's readiness to run
- keep product/test links reliable
- allow different projects to run at the same time
- prevent duplicate/conflicting runs inside the same project
- show all live workers in one operations view
- make every run result executive-readable
- keep stale/zombie/offline runner states impossible to mistake for live work

The CEO explicitly wants the current Claude Design UI direction preserved. New tabs/pages should extend the existing dark operational interface: compact cards, thin borders, uppercase section labels, restrained status colors, existing badges/buttons/tabs, and no new visual language.

### What Is Proven Working

- Command Center can launch an SDK worker against LeadQual.
- The worker can edit the real repo, commit/push, and trigger Vercel deployment.
- Command Center can receive the worker result and show a structured run brief.
- Feedback-to-fix planning works: CEO feedback can become a scoped work plan before launch.
- Runner auto-recovery now works locally:
  - `GET /api/runner-health` reports `online/offline`.
  - `POST /api/runner-health` starts `npx inngest-cli@latest dev -u <current-origin>/api/inngest` when offline.
  - UI now shows `Starting runner...` instead of a dead offline state.
  - Inngest client now forces dev mode outside production so local `next dev` can register functions even if `INNGEST_DEV=1` was omitted.
- Recent focused tests passed:

```bash
node --experimental-strip-types --test lib/dev-runner-health.test.ts lib/run-activity-view.test.ts lib/chat-run-thread.test.ts lib/inngest-run-store.test.ts
```

Result: 23 tests passed.

### Current Dev Server / Runner State

At handoff time, Command Center was running at:

```text
http://127.0.0.1:3010
```

Health checks recently verified:

```text
GET /api/runner-health -> {"runnerAvailable":true,"runnerState":"online"}
GET /api/inngest -> mode "dev", function_count 4
HEAD /projects/leadqual/work -> 200
```

Do not run `npm run build` while `next dev` is active on the same `.next` directory.

### LeadQual Status

LeadQual can sit for now. It proved the Command Center loop.

Recent LeadQual worker run:

- Fixed the first 504 failure by splitting prospect search into discovery + enrichment batches.
- Production link from worker output: `https://lead-qualifier-ten.vercel.app`
- CEO tested again and saw partial success:
  - 15 businesses discovered
  - first enrichment batch loaded 4 prospects
  - second enrichment batch failed with HTTP 504
  - UI preserved partial results and clearly said only 4 of 15 loaded

Analysis: the LeadQual fix improved the flow, but enrichment batches of 4 are still too heavy. Future LeadQual fix should use smaller enrichment batches, retry once, and fall back to basic Phase 1 results for remaining businesses instead of stopping early. Do not prioritize this before Command Center infrastructure unless the CEO redirects.

### Known Command Center Bug: Product Links Lost

The Overview page currently says:

```text
No Vercel product link is connected yet.
```

even though the LeadQual URL exists in recent worker output.

Root cause found, not fixed yet:

- `components/project-operator.tsx` reads links from `project.deploymentLinks` or `project.investigation.deploymentDetails`.
- `/api/projects/leadqual` currently serves the fast Supabase snapshot path.
- `lib/runtime-store/phase1-store.ts` refreshes jobs only and no longer calls full `getProjectStatus()`.
- Therefore it does not rerun `getVercelDeploymentLinks()`.
- The stored LeadQual snapshot has no top-level `deploymentLinks`.
- LeadQual also lacks `/Users/ohsay22/Developer/leadqual/.vercel/project.json`, so fresh lookup depends on token/project discovery.

Fix priority: make product links persistent and resilient. Source priority should be:

1. explicit project config/static known link
2. Vercel linked project resolver
3. latest worker-reported product URL
4. latest investigation deployment URL
5. local dev fallback

If Command Center has ever seen a valid product URL, it should not lose it.

### New Main Roadmap

Build Command Center infrastructure in this order:

1. **Reliable Product Links**
   - Stop losing known Vercel/test links.
   - Persist/fallback links per project.
   - Use latest worker output when Vercel resolver cannot discover a link.

2. **Project Readiness Board**
   - For every project, show `Ready`, `Missing setup`, or `Blocked`.
   - Check repo path, governance files, env requirements, product link, test command, deploy path, and “do not break” notes.

3. **Parallel Execution Policy**
   - Allow many projects to run simultaneously.
   - Enforce one active run per project to avoid conflicting workers in the same repo.
   - Make queued/blocked states explicit.

4. **Live Operations View**
   - One page/tab showing all active workers across projects.
   - Show project, current task, live/not-live, last heartbeat, elapsed time, status, and stop/retry controls.

5. **Standard Executive Run Cards**
   - Every result card should show:
     - bottom line
     - product link
     - what changed
     - what to test
     - still open
   - Raw logs/activity traces stay hidden behind execution detail.

6. **Runner/Zombie Hardening**
   - Keep runner auto-start.
   - Keep stale queued/active timeout behavior.
   - Never show old logs as current live activity.
   - Make idle/offline/starting/running states obvious.

7. **Future Project Onboarding**
   - New projects should receive the same readiness contract automatically.
   - LeadQual should become the standard pattern, not a one-off.

### Important Files For Next Work

Read these first:

- `HANDOFF.md`
- `HANDOFF-CODEX-NEXT.md`
- `lib/project-page-data.ts`
- `lib/runtime-store/phase1-store.ts`
- `lib/runtime-store/phase1-serialization.ts`
- `lib/project-status.ts`
- `lib/vercel-deployments.ts`
- `components/project-operator.tsx`
- `components/runner-strip.tsx`
- `lib/dev-runner-health.ts`
- `lib/run-ceo-brief.ts`
- `lib/run-activity-view.ts`
- `lib/inngest-run-store.ts`
- `lib/orchestration.ts`

### Git / Dirty Worktree Warning

The worktree is very dirty and contains intentional pre-existing changes plus untracked files. Do not reset, clean, or revert unrelated files.

Use `git status --short` before editing. Preserve user and previous-agent changes.

---

## Historical Notes From Earlier Session

## Current Goal

Command Center is being upgraded into an execution console that can take CEO feedback, create an approval-gated plan, run a Claude SDK worker through the existing durable execution path, then return a clear executive result.

The proof project is **LeadQual**. The current LeadQual product direction is a three-mode lead engine:

- Find AI Prospects: existing Indeed flow, keep intact.
- Find My Clients: find agencies/sales teams the founder can sell lead lists to.
- Build a Lead List: client-facing $250 product, highest priority.

The CEO workflow target is:

```text
Project -> Plan structured work -> Approve plan -> SDK worker executes -> CEO gets product link + what changed + what to test + gaps -> CEO sends feedback -> Command Center creates next fix plan
```

## Current App State

Command Center dev server has been running at:

```text
http://127.0.0.1:3010
```

LeadQual local dev server has also been running at:

```text
http://127.0.0.1:5173
```

LeadQual production/canonical Vercel link:

```text
https://lead-qualifier-ten.vercel.app/
```

Do not hard-code product links into UI components. Product links should come from the Vercel deployment resolver and project status plumbing.

## Important Recent Fixes

### SDK worker path

- `lib/agent-runner.ts` uses the Claude Agent SDK worker path.
- Default max turns was raised to `80`.
- It can be configured with `WORKER_AGENT_MAX_TURNS`.
- Focused test: `lib/agent-runner.test.ts`.

### Approval-gated work orders

- `components/project-operator.tsx` has the structured work-order panel.
- Plans must be created and approved before execution.
- Active plans are locked/frozen while a run is active.
- A blocked/cancelled plan can be continued instead of retyping the whole thing.
- Plan execution state helper: `lib/work-order-execution-state.ts`.
- Planner helper/tests: `lib/work-order-planner.ts`, `lib/work-order-planner.test.ts`.

### Feedback-to-fix flow

- Project Work page has a **Test feedback** section.
- CEO can enter:
  - what happened
  - what should happen instead
- Command Center creates a new fix plan from feedback, but does not auto-launch it.
- Helper: `lib/feedback-work-order.ts`.
- Test: `lib/feedback-work-order.test.ts`.

### Live worker activity

- New runs launched after the patch can emit live activity into `commentary` artifacts.
- UI label should be **Agent is doing now**.
- This is intended to show more than just “Executing”, but currently the displayed status is still not detailed enough for the CEO.
- Relevant files:
  - `lib/agent-runner.ts`
  - `inngest/functions/project-task.ts`
  - `components/project-operator.tsx`

### Governance/write timeout fix

- A run got stuck in `updating_governance` because a worker log was about 1.95 MB and Supabase writes timed out.
- `inngest/functions/project-task.ts` now truncates final message/execution log artifacts at `MAX_ARTIFACT_CHARS = 120_000`.
- Live activity writes are throttled to reduce Supabase load.

### UI speed fix

- `lib/runtime-store/phase1-store.ts` cached path no longer calls heavyweight full project status.
- It uses lightweight run rows/previews.
- `lib/project-page-data.ts` reads project tabs in parallel.
- Measured after fix:

```text
/projects/leadqual/work -> 200 in about 0.88s
/api/projects/leadqual -> 200 in about 0.82s
```

Focused tests passed after the speed fix:

```bash
node --experimental-strip-types --test lib/feedback-work-order.test.ts lib/work-order-execution-state.test.ts lib/work-order-planner.test.ts lib/agent-runner.test.ts
```

## Current Problem To Fix Next

The run log cards are still too vague.

The CEO saw run cards saying things like:

- “This run needs review before you rely on it.”
- “No explicit test step was captured by the worker.”
- “Worker was cancelled by the operator.”

That is technically true, but not useful.

The next fix should make run outcomes executive-readable:

- Bottom line: what actually happened.
- Product link: latest Vercel/local test link.
- What changed: concrete code/product change, or say no verified code changes if cancelled.
- What to test: concrete CEO test steps.
- Still open: remaining gaps/blockers/decision needed.

For cancelled runs, the card should say something like:

```text
Cancelled before completion. No verified product changes came out of this run.
Nothing new needs CEO testing from this cancelled run. Continue or retry the plan if the fix is still needed.
```

For successful or awaiting-CEO runs, parse the worker’s actual final output and prefer useful sections such as:

- outcome
- what changed
- what to test
- deployed/product link
- open gaps
- CEO decision needed

Relevant files:

- `lib/run-ceo-brief.ts`
- `lib/run-ceo-brief.test.ts`
- `components/project-operator.tsx`
- `lib/inngest-run-presentation.ts`
- `lib/project-status.ts`

Recommended first move in the next chat:

```bash
sed -n '1,260p' lib/run-ceo-brief.ts
sed -n '1,260p' lib/run-ceo-brief.test.ts
```

Then add tests for:

- cancelled run produces a clear no-test/no-code-result summary
- rich worker message produces useful what-changed and what-to-test fields
- awaiting-CEO/decision run surfaces the decision needed instead of generic review language

## LeadQual Test Context

The user tested LeadQual and hit this issue:

- Mode: Find My Clients / prospect search
- City: Oakland
- Niche: Marketing agencies
- Count: 15
- Result: red error card said “No businesses found. Try a larger city or different niche.”

The CEO wants LeadQual to explain the reason more clearly, but the immediate Command Center goal is broader:

Command Center should accept that feedback, generate a fix plan, execute the fix, and come back with what changed and what to test.

## Recent Run Context

One LeadQual fix run was launched from feedback and later cancelled after getting stuck in governance update.

Known run ids from the session:

- `a047c8ab-92a3-47ca-bdbd-f90296b1d833`: successful LeadQual three-mode work, awaiting CEO test/decision.
- `cf8f12c3-dcb1-4304-a0e5-bf74a1a93a43`: feedback fix run that got stuck in `updating_governance` and was cancelled by the operator.

The cancelled run should not imply there is a new product result to test.

## UX Rules From The CEO

Preserve these.

- Project pages should not spam notifications for their own routine progress.
- Same-project routine progress belongs in the assignment progress panel.
- Notifications should be global/outside project tabs and only for completed, error, blocker, cancelled, or needs-decision states.
- Every change must come back with “what to test”.
- The UI must not fall back to raw HTML styling.
- Do not run `npm run build` against the same `.next` directory while `next dev` is serving the app. This caused CSS/JS chunk mismatch and raw HTML-looking UI.
- If a build is required, stop dev first or use an isolated build/worktree.

## Verification Guidance

Useful focused test command:

```bash
node --experimental-strip-types --test lib/run-ceo-brief.test.ts lib/feedback-work-order.test.ts lib/work-order-execution-state.test.ts lib/work-order-planner.test.ts lib/agent-runner.test.ts
```

Useful smoke checks while the dev server is up:

```bash
curl -s -o /tmp/cc-work.html -w '%{http_code} %{time_total}\n' http://127.0.0.1:3010/projects/leadqual/work
curl -s -o /tmp/cc-api.json -w '%{http_code} %{time_total}\n' http://127.0.0.1:3010/api/projects/leadqual
```

Repo-wide `tsc --noEmit` has not been a clean signal because there are existing test/import/config issues across the tree. Prefer focused tests unless the next task is specifically TypeScript cleanup.

## Git / Dirty Worktree Note

The worktree is dirty with intentional ongoing Command Center changes and some untracked helper/test files. Do not reset or revert unrelated files.

Before editing any file, inspect it first and preserve current work.

## Suggested New Chat Prompt

Paste this into a new chat:

```text
We are continuing Command Center from /Users/ohsay22/Developer/command-center. Read HANDOFF.md first.

Current task: fix the run result/log cards so they are executive-readable. The CEO does not want vague text like “This run needs review before you rely on it.” They need bottom line, product link, what changed, what to test, and still-open gaps.

Start by inspecting:
- lib/run-ceo-brief.ts
- lib/run-ceo-brief.test.ts
- components/project-operator.tsx

Add/adjust tests first for:
- cancelled run: clear no verified code change / nothing new to test / continue or retry if still needed
- rich worker output: extract useful what changed and what to test
- awaiting-CEO decision: surface the decision needed instead of generic review language

Then implement the smallest fix. Preserve the current dark UI, plan persistence, feedback-to-fix flow, Vercel product links, and SDK worker path. Do not run npm run build while next dev is active. Run focused tests and tell me exactly what to test in the UI when done.
```
