# Command Center Codex Next Handoff

## Where We Are

Command Center has proven the core execution loop with LeadQual:

```text
CEO feedback -> approval-gated plan -> SDK worker -> real repo changes -> deploy -> executive result card -> CEO test feedback
```

LeadQual can sit for now. The priority is Command Center itself.

The new product goal is to make Command Center the multi-project operating desk:

- reliable project/product links
- readiness status for every project
- live view of all workers
- parallel work across projects
- one active run per project
- executive-readable run result cards
- no stale/zombie/old activity presented as live

Preserve the existing Claude Design UI direction. New pages/tabs must feel native to the current dark operational interface.

## What Was Just Proven

- LeadQual worker runs can be launched from Command Center.
- Workers can edit the real LeadQual repo, commit/push, and trigger Vercel deployment.
- Command Center can show structured run output and test instructions.
- Feedback-to-fix planning works.
- Runner auto-recovery now works locally:
  - `GET /api/runner-health` returns health.
  - `POST /api/runner-health` starts Inngest dev runner when offline.
  - UI shows `Starting runner...`.
  - `inngest/client.ts` uses dev mode outside production so local function registration works.

Recent verification:

```bash
node --experimental-strip-types --test lib/dev-runner-health.test.ts lib/run-activity-view.test.ts lib/chat-run-thread.test.ts lib/inngest-run-store.test.ts
```

Result: 23 passing.

Recent smoke:

```text
GET /api/runner-health -> {"runnerAvailable":true,"runnerState":"online"}
GET /api/inngest -> mode "dev", function_count 4
HEAD /projects/leadqual/work -> 200
```

Do not run `npm run build` while `next dev` is active.

## Current Known Bug To Fix First

Product links are being lost.

The LeadQual worker output contains:

```text
https://lead-qualifier-ten.vercel.app
```

but the Overview UI says:

```text
No Vercel product link is connected yet.
```

Root cause:

- `components/project-operator.tsx` reads `project.deploymentLinks` and `project.investigation.deploymentDetails`.
- When Supabase is configured, `lib/project-page-data.ts` returns `readProjectPageDataFromStore()`.
- `lib/runtime-store/phase1-store.ts` now refreshes only jobs for speed.
- That means it no longer calls full `getProjectStatus()`.
- So it no longer reruns `getVercelDeploymentLinks()`.
- The stored LeadQual project snapshot has no top-level `deploymentLinks`.
- LeadQual also has no local `.vercel/project.json`, so Vercel resolver cannot recover from local project metadata.

Fix should make product/test links persistent and resilient.

Recommended source priority:

1. explicit project config/static known link
2. Vercel linked project resolver
3. latest worker-reported product URL
4. latest investigation deployment URL
5. local dev fallback

Rule: if Command Center has ever seen a valid product URL for a project, it should keep surfacing it.

## Main Implementation Roadmap

Work in this order unless the user redirects:

1. Reliable product link persistence/detection.
2. Project readiness board.
3. Parallel execution policy: one active run per project, many projects may run at once.
4. Live operations view for all active workers.
5. Standard executive run result cards everywhere.
6. Runner/zombie/offline hardening.
7. Future-project onboarding contract.

## Read These Files First

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

## LeadQual Status

LeadQual is not the main priority now.

Recent LeadQual product result:

- Search batching worked partially.
- It discovered 15 businesses.
- It enriched and displayed 4 prospects.
- Batch 2 failed with HTTP 504.
- The UI preserved partial results and clearly said only 4 of 15 loaded.

Future LeadQual fix, when resumed:

- reduce enrichment batch size from 4 to 1 or 2
- retry a failed batch once
- if enrichment fails, add basic Phase 1 results for remaining businesses instead of stopping early

## Working Constraints

- The worktree is dirty with intentional changes. Do not reset or clean.
- Use focused tests.
- Do not run `npm run build` while Next dev is active.
- Keep the current Claude Design UI.
- Keep raw logs behind expandable detail.
- Keep the SDK worker path.
- Keep feedback-to-fix and approval-gated plans.

## Suggested First Test Target

Add focused coverage around project link resolution/persistence before fixing implementation.

Good places to test:

- `lib/runtime-store/phase1-store.test.ts`
- `lib/project-status.ts` / `lib/vercel-deployments.test.ts`
- a small new helper test if link extraction/persistence becomes its own module

Expected behavior to prove:

- stored project status with missing `deploymentLinks` can be enriched or backfilled
- latest worker message containing a Vercel URL can produce a product link fallback
- Overview product links do not disappear just because Vercel API/project metadata is unavailable
