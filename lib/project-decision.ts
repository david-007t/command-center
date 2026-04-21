import { promises as fs } from "fs"
import path from "path"
import { randomUUID } from "crypto"
import {
  getDeveloperPath,
  readProjectRuntimeState,
  writeProjectRuntimeState,
} from "@/lib/orchestration"
import { recordProjectRuntimeUpdated, recordRuntimeEvent } from "@/lib/runtime-events"

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function replaceSection(markdown: string, title: string, content: string) {
  const pattern = new RegExp(`## ${escapeRegExp(title)}([\\s\\S]*?)(\\n## |$)`)
  if (!pattern.test(markdown)) {
    return `${markdown.trim()}\n\n## ${title}\n\n${content.trim()}\n`
  }

  return markdown.replace(pattern, `## ${title}\n\n${content.trim()}\n\n$2`)
}

function readSection(markdown: string, title: string) {
  return markdown.match(new RegExp(`## ${escapeRegExp(title)}([\\s\\S]*?)(\\n## |$)`))?.[1]?.trim() ?? ""
}

function replacePortfolioRow(markdown: string, projectName: string, nextAction: string, blocker: string) {
  const lines = markdown.split("\n")
  const nextLines = lines.map((line) => {
    if (!line.startsWith(`| ${projectName} |`)) return line
    const cells = line.split("|")
    if (cells.length < 8) return line
    cells[4] = ` ${blocker} `
    cells[5] = ` ${nextAction} `
    return cells.join("|")
  })

  return nextLines.join("\n")
}

function removePendingDecision(markdown: string, projectName: string) {
  return markdown.replace(new RegExp(`^- ${escapeRegExp(projectName)}:.*\\n?`, "m"), "")
}

type DecisionCopy = {
  decidedAt: string
  nextAction: string
  blocker: string
  taskSections: {
    blocked: string
    upNext: string
    done: string
  }
  handoffNextSteps: string
  runtimeSummary: string
  runtimeMessage: string
}

function buildDecisionCopy(projectName: string, decision: string, note: string): DecisionCopy | null {
  const decidedAt = new Date().toISOString().slice(0, 10)
  const noteLine = note ? ` Operator note: ${note}` : ""

  if (projectName === "leadqual" && decision === "single_user_v1") {
    return {
      decidedAt,
      nextAction:
        "Run the `vercel dev` happy-path QA pass, then rewrite the QA/security gates to match the approved single-user v1 scope before rerunning release checks.",
      blocker:
        "The v1 scope decision is resolved: Leadqual remains single-user. The remaining blockers are QA evidence, the release-gate rewrite, and the SMTP/dependency security issues.",
      taskSections: {
        blocked:
          "- [ ] [INFERRED] No active CEO scope blocker remains. The single-user v1 decision is resolved; only concrete QA/security execution blockers should re-block the project now.",
        upNext: [
          "- [ ] Run `vercel dev` with valid env vars and execute the AI lead-generation happy path end to end, then capture desktop, 375px mobile, console, and network evidence for `QA_CHECKLIST.md`.",
          "- [ ] Rewrite `QA_CHECKLIST.md` and `SECURITY_CHECKLIST.md` so the release gates match the approved single-user v1 scope, then rerun the gates.",
          "- [ ] Remove or redesign `api/send-email.js` so SMTP credentials are never accepted from the client, then rerun security verification.",
        ].join("\n"),
        done:
          `- [x] [INFERRED] CEO confirmed Leadqual v1 stays single-user, so the team should align release gates to that scope instead of adding auth/RLS first. — completed: ${decidedAt} — by: CEO${noteLine}`,
      },
      handoffNextSteps: [
        "1. Treat the v1 scope question as resolved: Leadqual remains a single-user release target.",
        "2. Run `vercel dev` and capture the happy-path QA evidence for desktop and 375px mobile.",
        "3. Rewrite `QA_CHECKLIST.md` and `SECURITY_CHECKLIST.md` to the approved single-user v1 scope, then rerun the gates.",
        "4. Keep `api/send-email.js` and dependency/security cleanup in scope after the gate rewrite.",
      ].join("\n"),
      runtimeSummary:
        "CEO confirmed Leadqual v1 stays single-user. The system can now rewrite the release gates to match that scope and proceed with runtime QA.",
      runtimeMessage:
        `CEO DECISION RECORDED: Leadqual v1 stays single-user. The next agent should run the \`vercel dev\` happy-path QA pass, then rewrite the QA/security gates to match the approved single-user scope.${note ? ` Operator note: ${note}` : ""}`,
    }
  }

  if (projectName === "leadqual" && decision === "auth_rls_v1") {
    return {
      decidedAt,
      nextAction:
        "Implement auth, protected routes, and RLS/user isolation before another release-gate pass, then rerun QA/security verification.",
      blocker:
        "The v1 scope decision is resolved: Leadqual now requires auth/RLS. The remaining blockers are implementation work plus the SMTP/dependency security issues.",
      taskSections: {
        blocked:
          "- [ ] [INFERRED] No active CEO scope blocker remains. The multi-user/auth decision is resolved; the project is now blocked only on implementation and verification work.",
        upNext: [
          "- [ ] Implement auth, protected routes, and RLS/user isolation so the current release gates are real instead of aspirational.",
          "- [ ] After auth/RLS work lands, run `vercel dev` and capture desktop, 375px mobile, console, and network evidence for the QA/security gates.",
          "- [ ] Remove or redesign `api/send-email.js` so SMTP credentials are never accepted from the client, then rerun security verification.",
        ].join("\n"),
        done:
          `- [x] [INFERRED] CEO confirmed Leadqual v1 must support auth/RLS before release, so the team should implement multi-user protections before the next gate pass. — completed: ${decidedAt} — by: CEO${noteLine}`,
      },
      handoffNextSteps: [
        "1. Treat the v1 scope question as resolved: Leadqual must add auth/RLS before release.",
        "2. Implement auth, protected routes, and RLS/user isolation before more release-gate work.",
        "3. After that lands, run `vercel dev` and capture the runtime QA/security evidence.",
        "4. Keep `api/send-email.js` and dependency/security cleanup in scope after the auth work.",
      ].join("\n"),
      runtimeSummary:
        "CEO confirmed Leadqual must add auth/RLS before release. The system can now proceed with multi-user implementation instead of rewriting the gates.",
      runtimeMessage:
        `CEO DECISION RECORDED: Leadqual v1 requires auth, protected routes, and RLS before release. The next agent should implement those protections, then rerun QA/security verification.${note ? ` Operator note: ${note}` : ""}`,
    }
  }

  if (projectName === "rbc" && decision === "pipeline/run.py") {
    return {
      decidedAt,
      nextAction:
        "Rewrite the blocked mixed task into one atomic implementation item focused on `pipeline/run.py`, `queue/`, and the exact supporting files required for the queue-first path.",
      blocker:
        "No CEO decision blocker remains; the next risk is execution discipline while the team converts the mixed task into one queue-first implementation item.",
      taskSections: {
        blocked:
          "- [ ] [INFERRED] No active CEO blocker remains. The prior mixed-task blocker is resolved by the decision to center v1 on `pipeline/run.py`. The next agent should only re-block if a new concrete engineering issue appears.",
        upNext: [
          "- [ ] [INFERRED] Highest priority: replace the blocked mixed task with one atomic implementation task focused on `pipeline/run.py`, `queue/`, and the exact supporting files required for the queue-first path.",
          "- [ ] [INFERRED] Treat `run_days.py` as a secondary follow-on path until the queue-first v1 workflow is stable and verified.",
          "- [ ] [INFERRED] Run the full QA and security checklists only after the queue-first implementation task is completed and verified.",
        ].join("\n"),
        done:
          `- [x] [INFERRED] CEO selected \`pipeline/run.py\` as the v1 primary entrypoint, unblocking the next atomic build task. — completed: ${decidedAt} — by: CEO${noteLine}`,
      },
      handoffNextSteps: [
        "1. [INFERRED] Treat the entrypoint question as resolved: v1 centers `pipeline/run.py`.",
        "2. [INFERRED] Rewrite the blocked mixed task into one atomic implementation item that names the exact files for the queue-first path.",
        "3. [INFERRED] Keep `run_days.py` out of the first implementation pass unless the queue-first task proves it is required.",
      ].join("\n"),
      runtimeSummary: "CEO selected `pipeline/run.py` as the v1 path. The system can now convert the blocked mixed task into one queue-first implementation task.",
      runtimeMessage:
        `CEO DECISION RECORDED: v1 centers \`pipeline/run.py\`. The next agent should rewrite the blocked mixed task into one atomic queue-first implementation task with exact file targets.${note ? ` Operator note: ${note}` : ""}`,
    }
  }

  if (projectName === "rbc" && decision === "run_days.py") {
    return {
      decidedAt,
      nextAction:
        "Rewrite the blocked mixed task into one atomic implementation item focused on `run_days.py` and the adjacent portability dependencies it requires.",
      blocker:
        "No CEO decision blocker remains; the next risk is making the day-compilation workflow portable without reopening mixed-scope work.",
      taskSections: {
        blocked:
          "- [ ] [INFERRED] No active CEO blocker remains. The prior mixed-task blocker is resolved by the decision to center v1 on `run_days.py`. The next agent should only re-block if a new concrete engineering issue appears.",
        upNext: [
          "- [ ] [INFERRED] Highest priority: replace the blocked mixed task with one atomic implementation task focused on `run_days.py`, `pipeline/curator.py`, `pipeline/scripts/quality_filter.py`, and any other exact files required for the day-compilation path.",
          "- [ ] [INFERRED] Treat `pipeline/run.py` as a secondary path until the day-compilation v1 workflow is portable and verified.",
          "- [ ] [INFERRED] Run the full QA and security checklists only after the day-compilation implementation task is completed and verified.",
        ].join("\n"),
        done:
          `- [x] [INFERRED] CEO selected \`run_days.py\` as the v1 primary entrypoint, unblocking the next atomic build task. — completed: ${decidedAt} — by: CEO${noteLine}`,
      },
      handoffNextSteps: [
        "1. [INFERRED] Treat the entrypoint question as resolved: v1 centers `run_days.py`.",
        "2. [INFERRED] Rewrite the blocked mixed task into one atomic implementation item that names the exact files for the day-compilation path and portability work.",
        "3. [INFERRED] Include adjacent portability dependencies in scope instead of changing `run_days.py` in isolation.",
      ].join("\n"),
      runtimeSummary: "CEO selected `run_days.py` as the v1 path. The system can now convert the blocked mixed task into one day-compilation implementation task.",
      runtimeMessage:
        `CEO DECISION RECORDED: v1 centers \`run_days.py\`. The next agent should rewrite the blocked mixed task into one atomic day-compilation implementation task with exact file targets.${note ? ` Operator note: ${note}` : ""}`,
    }
  }

  return null
}

export async function applyProjectDecision(projectName: string, decision: string, note = "") {
  const developerPath = getDeveloperPath()
  const decisionCopy = buildDecisionCopy(projectName, decision, note.trim())
  if (!decisionCopy) {
    throw new Error(`Unsupported decision for project ${projectName}.`)
  }

  const projectDir = path.join(developerPath, projectName)
  const tasksPath = path.join(projectDir, "TASKS.md")
  const handoffPath = path.join(projectDir, "HANDOFF.md")
  const portfolioPath = path.join(developerPath, "PORTFOLIO.md")

  const [tasksMarkdown, handoffMarkdown, portfolioMarkdown, runtimeState] = await Promise.all([
    fs.readFile(tasksPath, "utf8"),
    fs.readFile(handoffPath, "utf8"),
    fs.readFile(portfolioPath, "utf8"),
    readProjectRuntimeState(developerPath, projectName),
  ])

  const completedAt = new Date().toISOString()
  const runtimeJobId = runtimeState?.jobId ?? `decision-${randomUUID()}`
  const existingDone = readSection(tasksMarkdown, "Done this sprint")
  const nextTasks = replaceSection(tasksMarkdown, "Blocked", decisionCopy.taskSections.blocked)
  const withUpNext = replaceSection(nextTasks, "Up next", decisionCopy.taskSections.upNext)
  const withDone = replaceSection(withUpNext, "Done this sprint", `${decisionCopy.taskSections.done}\n${existingDone}`.trim())
  const updatedTasks = withDone.replace(/^# Last updated: .*$/m, `# Last updated: ${decisionCopy.decidedAt} by CEO`)

  const updatedHandoff = replaceSection(
    handoffMarkdown.replace(/^# Session date: .*$/m, `# Session date: ${decisionCopy.decidedAt}`),
    "What the next agent should do first",
    decisionCopy.handoffNextSteps,
  )

  const updatedPortfolio = removePendingDecision(
    replacePortfolioRow(portfolioMarkdown, projectName, decisionCopy.nextAction, decisionCopy.blocker).replace(
      /^# Last updated: .*$/m,
      `# Last updated: ${decisionCopy.decidedAt}`,
    ),
    projectName,
  )

  await Promise.all([
    fs.writeFile(tasksPath, updatedTasks, "utf8"),
    fs.writeFile(handoffPath, updatedHandoff, "utf8"),
    fs.writeFile(portfolioPath, updatedPortfolio, "utf8"),
    writeProjectRuntimeState(developerPath, projectName, {
      projectName,
      jobId: runtimeJobId,
      runTemplate: runtimeState?.runTemplate ?? "review_next_move",
      status: "healthy",
      summary: decisionCopy.runtimeSummary,
      governanceUpdated: true,
      governanceTargets: ["TASKS.md", "HANDOFF.md", "PORTFOLIO.md"],
      updatedTargets: ["TASKS.md", "HANDOFF.md", "PORTFOLIO.md"],
      missingTargets: [],
      completedAt,
      messagePreview: decisionCopy.runtimeMessage,
      currentStage: "done",
      stageUpdatedAt: completedAt,
    }),
  ])

  await recordProjectRuntimeUpdated({
    projectName,
    summary: decisionCopy.runtimeSummary,
    reason: "decision",
    job: {
      id: runtimeJobId,
      projectName,
      runTemplate: runtimeState?.runTemplate ?? "review_next_move",
      instruction: decisionCopy.runtimeMessage,
      status: "completed",
      currentStage: "done",
      summary: decisionCopy.runtimeSummary,
      completedAt,
    },
    payload: { decision, note },
  }).catch(() => null)

  await recordRuntimeEvent({
    eventType: "decision_resolved",
    projectName,
    scope: "project",
    reason: "decision",
    title: "CEO decision recorded",
    body: decisionCopy.runtimeSummary,
    payload: { decision, note },
    job: {
      id: runtimeJobId,
      projectName,
      runTemplate: runtimeState?.runTemplate ?? "review_next_move",
      instruction: decisionCopy.runtimeMessage,
      status: "completed",
      currentStage: "done",
      summary: decisionCopy.runtimeSummary,
      completedAt,
    },
  }).catch(() => null)

  return {
    ok: true,
    projectName,
    decision,
    summary: decisionCopy.runtimeSummary,
  }
}
