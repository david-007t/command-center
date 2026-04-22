# Command Center Handoff

## Current state

- Repo: `/Users/ohsay22/Developer/command-center`
- Live app: `http://localhost:3010`
- Current production server command: `npm run start -- --port 3010`
- The app currently builds cleanly with `npm run build`
- The live server was rebuilt and restarted after the latest changes in this session

## What is now working

### Real project page split

Project pages are now real routes instead of one long anchor page:

- `/projects/[name]/overview`
- `/projects/[name]/work`
- `/projects/[name]/log`

`/projects/[name]` now redirects to `/projects/[name]/overview`.

Verified live on port `3010`:

- `/projects/rbc` returns a redirect to `/projects/rbc/overview`
- `/projects/rbc/overview` returns `200`
- `/projects/rbc/work` returns `200`
- `/projects/rbc/log` returns `200`

### Runtime stage tracking

Jobs now persist stage transitions in runtime job records:

- `queued`
- `reading_context`
- `planning`
- `executing`
- `verifying`
- `updating_governance`
- `done`
- `blocked`

The project `Work` page shows the assignment progress tracker for active runs.

### Trust / evidence model

Project runtime state now surfaces trust as:

- `confirmed`
- `inferred`
- `unverified`

Anelo now correctly shows:

- `Git branch wiring` = confirmed
- `Stage preview deployment` = unverified

instead of falsely implying staging is fully verified.

### New investigation lane

This session added a first-class `investigate_issue` run template.

The system now supports:

- investigation recommendations in project status
- an investigation summary block on the project `Work` page
- an `Investigate issue` action button

For Anelo specifically, the project API now returns an `investigation` object with:

- `title`
- `summary`
- `checks`
- `likelyCause`
- `nextStep`
- `canAutofix`
- `suggestedTemplate`
- `suggestedInstruction`

The live Anelo `Work` page now renders:

- `System investigation`
- `Investigate missing stage preview`
- `Likely cause`
- `Exact next fix`
- `Run investigation`

## What is still not done

### The investigator is advisory-first, not fully autonomous yet

The app now frames investigations correctly, but it does not yet have deep service-specific automation for:

- Vercel deployment inspection and remediation
- GitHub deployment-trigger diagnosis
- automatic no-op commit / push flow to force preview generation
- confirming preview URLs from external systems and feeding that proof back into trust automatically

In other words:

- the UI and run template exist
- the reasoning scaffold exists
- the actual service-integrated auto-debugger is still incomplete

### Dashboard still needs investigation summaries

The dashboard now shows trust better than before, but it does not yet show the full:

- likely cause
- exact next fix
- run investigation

flow as richly as the per-project `Work` page.

That is likely the next best UX improvement.

## Highest-priority next tasks

### 1. Make investigation runs actually use external evidence

Start with Anelo and deployment problems.

Goal:

- when trust has `external_deploy = unverified`, the worker should investigate Vercel state directly and return a concrete result

Suggested path:

1. add service-aware investigation helpers for:
   - local git
   - runtime logs
   - GitHub state
   - Vercel deployment state
2. teach investigation runs to use those helpers explicitly
3. persist investigation findings into runtime/project state
4. if safe, allow the run to perform a narrow remediation

For Anelo, the likely first remediation path is:

- inspect whether `stage` has any preview deployment
- if not, determine whether a fresh `stage` push is required
- if safe and approved by product rules, trigger the narrowest action to force preview generation
- then verify whether the preview exists

### 2. Surface investigation summaries on the dashboard

The main dashboard should not stop at:

- `unverified`

It should also show:

- what the system checked
- likely cause
- exact next fix
- one-click `Investigate issue`

### 3. Make `command-center` a first-class managed project

This is product-direction work already discussed with the user.

Target:

- `command-center` itself should appear as a managed project with the same:
  - overview
  - work
  - log
  - decisions
  - runtime jobs
  - investigation flows

### 4. Continue reducing false certainty

The product direction is explicitly:

- never lie
- say `confirmed`, `inferred`, or `unverified`
- only claim deployment success with actual proof

That principle should continue expanding beyond trust cards into:

- dashboard recommendations
- decision prompts
- “healthy / on track” summaries
- chat responses

## Important files changed in this session

### Page split

- `/Users/ohsay22/Developer/command-center/app/projects/[name]/page.tsx`
- `/Users/ohsay22/Developer/command-center/app/projects/[name]/overview/page.tsx`
- `/Users/ohsay22/Developer/command-center/app/projects/[name]/work/page.tsx`
- `/Users/ohsay22/Developer/command-center/app/projects/[name]/log/page.tsx`
- `/Users/ohsay22/Developer/command-center/lib/project-page-data.ts`

### Investigation flow

- `/Users/ohsay22/Developer/command-center/lib/orchestration.ts`
- `/Users/ohsay22/Developer/command-center/lib/project-status.ts`
- `/Users/ohsay22/Developer/command-center/app/api/runs/route.ts`
- `/Users/ohsay22/Developer/command-center/components/project-operator.tsx`

### Trust / dashboard work from earlier in the session

- `/Users/ohsay22/Developer/command-center/lib/project-trust.ts`
- `/Users/ohsay22/Developer/command-center/app/api/portfolio/route.ts`
- `/Users/ohsay22/Developer/command-center/app/page.tsx`

### Tests

- `/Users/ohsay22/Developer/command-center/lib/orchestration-stage.test.ts`
- `/Users/ohsay22/Developer/command-center/lib/project-trust.test.ts`
- `/Users/ohsay22/Developer/command-center/lib/executive-runtime-decision.test.ts`

## Verified commands

Run from `/Users/ohsay22/Developer/command-center`:

```bash
npm run build
node --experimental-strip-types --test /Users/ohsay22/Developer/command-center/lib/orchestration-stage.test.ts
```

The app was then restarted on port `3010` with:

```bash
npm run start -- --port 3010
```

## Known live product truth for Anelo

As of this handoff:

- `stage` branch exists and local git wiring is confirmed
- Vercel Git settings looked normal from the screenshots the user provided
- the first `stage` preview deployment was still not externally verified
- the system now expresses that as an investigation target instead of pretending it is done

## Suggested opening prompt for the next Codex chat

Use this:

“Continue the command-center app from `/Users/ohsay22/Developer/command-center`. The page split into `/overview`, `/work`, and `/log` is done, trust/evidence cards are live, and an `investigate_issue` lane now exists. The next priority is to make investigation runs actually diagnose and remediate external deployment gaps like Anelo’s missing Vercel stage preview, and then surface that richer investigation summary on the dashboard.” 
