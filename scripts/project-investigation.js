const fs = require("fs/promises")
const path = require("path")
const { execFile } = require("child_process")
const { promisify } = require("util")

const execFileAsync = promisify(execFile)

function getDeveloperPath(projectDir) {
  return process.env.DEVELOPER_PATH || path.resolve(projectDir, "..")
}

function getInvestigationFilePath(projectDir, projectName) {
  return path.join(getDeveloperPath(projectDir), "_system", "runtime", "investigations", `${projectName}.json`)
}

async function ensureDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
}

async function safeExecFile(command, args, cwd) {
  try {
    const { stdout } = await execFileAsync(command, args, { cwd })
    return stdout.trim()
  } catch {
    return ""
  }
}

async function safeFetchJson(url, init = {}) {
  try {
    const response = await fetch(url, init)
    if (!response.ok) {
      return { ok: false, status: response.status, body: null }
    }

    return { ok: true, status: response.status, body: await response.json() }
  } catch {
    return { ok: false, status: 0, body: null }
  }
}

function parseGitHubRemote(remote) {
  const httpsMatch = remote.match(/github\.com[:/](.+?)\/(.+?)(?:\.git)?$/i)
  if (!httpsMatch) return null
  return {
    owner: httpsMatch[1],
    repo: httpsMatch[2],
  }
}

async function readLinkedVercelProject(projectDir) {
  const candidates = [path.join(projectDir, ".vercel", "project.json"), path.join(projectDir, "web", ".vercel", "project.json")]

  for (const candidate of candidates) {
    try {
      const raw = await fs.readFile(candidate, "utf8")
      const parsed = JSON.parse(raw)
      return {
        filePath: candidate,
        projectId: parsed.projectId,
        teamId: parsed.orgId,
        projectName: parsed.projectName,
      }
    } catch {}
  }

  return null
}

async function getLocalGitEvidence(projectDir) {
  const [currentBranch, upstream, localStageSha, remoteStageRef, statusOutput] = await Promise.all([
    safeExecFile("git", ["branch", "--show-current"], projectDir),
    safeExecFile("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], projectDir),
    safeExecFile("git", ["rev-parse", "--verify", "stage"], projectDir),
    safeExecFile("git", ["rev-parse", "--verify", "refs/remotes/origin/stage"], projectDir),
    safeExecFile("git", ["status", "--short"], projectDir),
  ])

  const trustChecks = []
  const evidence = []
  const cleanWorktree = statusOutput === ""

  if (currentBranch === "stage" && upstream === "origin/stage" && remoteStageRef) {
    trustChecks.push({
      label: "Git branch wiring",
      status: "confirmed",
      source: "local_repo",
      detail: "Local repo is on stage and tracks origin/stage.",
    })
    evidence.push({
      label: "Local stage branch wiring",
      status: "confirmed",
      source: "local_repo",
      detail: "Local repo is on stage and tracks origin/stage.",
    })
  } else if (currentBranch === "stage" || upstream === "origin/stage" || localStageSha) {
    trustChecks.push({
      label: "Git branch wiring",
      status: "inferred",
      source: "local_repo",
      detail: "Local repo suggests stage wiring exists, but the full local proof is incomplete.",
    })
    evidence.push({
      label: "Local stage branch wiring",
      status: "inferred",
      source: "local_repo",
      detail: "Stage exists locally, but the full tracking proof is incomplete.",
    })
  } else {
    evidence.push({
      label: "Local stage branch wiring",
      status: "unverified",
      source: "local_repo",
      detail: "No local stage branch proof was found in the repo.",
    })
  }

  return {
    currentBranch,
    upstream,
    localStageSha,
    remoteStageRef,
    cleanWorktree,
    trustChecks,
    evidence,
  }
}

async function getGitHubEvidence(projectDir) {
  const remote = await safeExecFile("git", ["remote", "get-url", "origin"], projectDir)
  const parsed = parseGitHubRemote(remote)
  if (!parsed) {
    return {
      evidence: [
        {
          label: "GitHub repo linkage",
          status: "unverified",
          source: "github",
          detail: "No GitHub origin remote could be parsed for this repo.",
        },
      ],
      trustChecks: [],
      owner: null,
      repo: null,
      stageBranchSha: null,
    }
  }

  const branchResponse = await safeFetchJson(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/branches/stage`, {
    headers: {
      "User-Agent": "command-center-investigation",
      Accept: "application/vnd.github+json",
    },
  })

  if (!branchResponse.ok || !branchResponse.body?.commit?.sha) {
    return {
      evidence: [
        {
          label: "GitHub stage branch",
          status: "unverified",
          source: "github",
          detail: "GitHub did not return a public stage branch for this repo.",
          url: `https://github.com/${parsed.owner}/${parsed.repo}/tree/stage`,
        },
      ],
      trustChecks: [],
      owner: parsed.owner,
      repo: parsed.repo,
      stageBranchSha: null,
    }
  }

  const stageBranchSha = branchResponse.body.commit.sha
  return {
    evidence: [
      {
        label: "GitHub stage branch",
        status: "confirmed",
        source: "github",
        detail: `GitHub reports a public stage branch at ${stageBranchSha.slice(0, 7)}.`,
        url: `https://github.com/${parsed.owner}/${parsed.repo}/tree/stage`,
      },
    ],
    trustChecks: [],
    owner: parsed.owner,
    repo: parsed.repo,
    stageBranchSha,
  }
}

async function getVercelEvidence(projectDir, branch) {
  const linkedProject = await readLinkedVercelProject(projectDir)
  if (!linkedProject?.projectId || !linkedProject?.teamId) {
    return {
      linkedProject,
      tokenConfigured: Boolean(process.env.VERCEL_TOKEN || process.env.VERCEL_API_TOKEN || process.env.VERCEL_AUTH_TOKEN),
      apiStatus: "missing_project_link",
      evidence: [
        {
          label: "Vercel project link",
          status: "unverified",
          source: "vercel",
          detail: "No linked Vercel project metadata was found in .vercel/project.json.",
        },
      ],
      trustChecks: [],
      stageDeployment: null,
      ready: false,
    }
  }

  const token = process.env.VERCEL_TOKEN || process.env.VERCEL_API_TOKEN || process.env.VERCEL_AUTH_TOKEN
  if (!token) {
    return {
      linkedProject,
      tokenConfigured: false,
      apiStatus: "missing_token",
      evidence: [
        {
          label: "Vercel deployment evidence",
          status: "unverified",
          source: "vercel",
          detail: "The project is linked to Vercel, but no Vercel API token is configured for live deployment inspection.",
        },
      ],
      trustChecks: [],
      stageDeployment: null,
      ready: false,
    }
  }

  const params = new URLSearchParams({
    projectId: linkedProject.projectId,
    teamId: linkedProject.teamId,
    limit: "20",
  })
  const deploymentsResponse = await safeFetchJson(`https://api.vercel.com/v6/deployments?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "command-center-investigation",
    },
  })

  if (!deploymentsResponse.ok || !Array.isArray(deploymentsResponse.body?.deployments)) {
    return {
      linkedProject,
      tokenConfigured: true,
      apiStatus: "blocked",
      evidence: [
        {
          label: "Vercel deployment evidence",
          status: "blocked",
          source: "vercel",
          detail: "The Vercel API did not return deployment data for the linked project.",
        },
      ],
      trustChecks: [],
      stageDeployment: null,
      ready: false,
    }
  }

  const stageDeployment = deploymentsResponse.body.deployments.find(
    (deployment) => deployment?.meta?.githubCommitRef === branch || deployment?.meta?.branchAlias?.includes(`-git-${branch}-`),
  )

  if (!stageDeployment) {
    return {
      linkedProject,
      tokenConfigured: true,
      apiStatus: "ok",
      evidence: [
        {
          label: "Stage preview deployment",
          status: "unverified",
          source: "vercel",
          detail: `No ${branch} preview deployment was returned by Vercel for the linked project.`,
        },
      ],
      trustChecks: [
        {
          label: "Stage preview deployment",
          status: "unverified",
          source: "external_deploy",
          detail: `No ${branch} preview deployment has been externally verified yet.`,
        },
      ],
      stageDeployment: null,
      ready: false,
    }
  }

  const ready = stageDeployment.state === "READY"
  const deploymentUrl = stageDeployment.url ? `https://${stageDeployment.url}` : undefined

  return {
    linkedProject,
    tokenConfigured: true,
    apiStatus: "ok",
    evidence: [
      {
        label: "Stage preview deployment",
        status: ready ? "confirmed" : "inferred",
        source: "vercel",
        detail: ready
          ? `Vercel reports a READY ${branch} preview deployment from commit ${String(stageDeployment?.meta?.githubCommitSha || "").slice(0, 7) || "unknown"}.`
          : `Vercel reports a ${branch} deployment in state ${stageDeployment.state || "unknown"}.`,
        url: deploymentUrl,
      },
    ],
    trustChecks: [
      {
        label: "Stage preview deployment",
        status: ready ? "confirmed" : "inferred",
        source: ready ? "external_deploy" : "worker_report",
        detail: ready
          ? `Vercel returned a READY ${branch} preview deployment for the linked project.`
          : `Vercel returned a ${branch} deployment, but it is not ready yet.`,
      },
    ],
    stageDeployment,
    ready,
  }
}

async function maybePushStageBranch(projectDir, git, github, vercel) {
  if (vercel.stageDeployment || !git.localStageSha || !git.cleanWorktree) {
    return {
      action: {
        kind: "push_stage_branch",
        status: "skipped",
        summary: vercel.stageDeployment
          ? "Skipped git remediation because a stage deployment already exists."
          : "Skipped git remediation because the repo is not in a clean state for an automatic push.",
      },
      attempted: false,
    }
  }

  if (github.stageBranchSha && github.stageBranchSha === git.localStageSha) {
    return {
      action: {
        kind: "push_stage_branch",
        status: "skipped",
        summary: "Skipped git remediation because GitHub already has the current stage branch head.",
      },
      attempted: false,
    }
  }

  const args = github.stageBranchSha ? ["push", "origin", "stage"] : ["push", "-u", "origin", "stage"]
  const pushed = await safeExecFile("git", args, projectDir)

  if (!pushed) {
    return {
      action: {
        kind: "push_stage_branch",
        status: "blocked",
        summary: "Tried to push the stage branch, but git did not confirm the push completed.",
      },
      attempted: true,
    }
  }

  return {
    action: {
      kind: "push_stage_branch",
      status: "completed",
      summary: "Pushed the stage branch to origin so external deployment systems can react to it.",
    },
    attempted: true,
  }
}

function buildSuggestedInstruction(projectName) {
  return `Investigate why ${projectName} does not yet have a verified Vercel stage preview deployment. Treat local git stage wiring as already confirmed when the evidence says it is. Use real GitHub and Vercel evidence, apply a low-risk remediation only if it is clearly safe, verify the result again, and update TASKS.md, ERRORS.md, and HANDOFF.md to match reality.`
}

function summarizeChecks(evidence) {
  return evidence.map((item) => `${item.label}: ${item.detail}`)
}

function summarizeDeploymentDetails(stageDeployment, branch) {
  if (!stageDeployment) return null
  return {
    branch,
    state: stageDeployment.state || "unknown",
    commitSha: String(stageDeployment?.meta?.githubCommitSha || "").slice(0, 7) || null,
    url: stageDeployment.url ? `https://${stageDeployment.url}` : null,
    createdAt: stageDeployment.createdAt ? new Date(stageDeployment.createdAt).toISOString() : null,
  }
}

function deriveInvestigationDiagnosis({ git, github, vercel, actions, branch = "stage" }) {
  const verified = []
  const inferred = []
  const blocked = []

  if (git.localStageSha) {
    verified.push("Local repo has a stage branch reference.")
  } else {
    blocked.push("Local repo does not currently show a stage branch reference.")
  }

  if (github.stageBranchSha) {
    verified.push("GitHub shows the stage branch upstream.")
  } else {
    blocked.push("GitHub does not currently show a stage branch for this repo.")
  }

  if (vercel.apiStatus === "missing_project_link") {
    blocked.push("The repo is not linked to a Vercel project, so deployment evidence cannot be inspected yet.")
    return {
      code: "missing_vercel_project_link",
      summary: "The investigation cannot inspect live deployment state because the repo is not linked to Vercel metadata.",
      likelyCause: "The most likely cause is that the project does not have usable .vercel project linkage in this workspace.",
      nextStep: "Link the project to Vercel metadata first, then re-run the investigation before assuming anything about preview deployment state.",
      recommendedAction: {
        kind: "link_vercel_project",
        summary: "Restore or create the local Vercel project link before trying deeper deployment diagnosis.",
      },
      verified,
      inferred,
      blocked,
    }
  }

  if (!vercel.tokenConfigured || vercel.apiStatus === "missing_token") {
    blocked.push("No Vercel API token is configured for live deployment inspection.")
    return {
      code: "missing_vercel_token",
      summary: "The investigation is blocked from checking Vercel directly because no API token is configured.",
      likelyCause: "The local runtime does not currently have the credentials needed to inspect live Vercel deployment state.",
      nextStep: "Configure Vercel API access for the system, then re-run the investigation so deployment proof comes from Vercel rather than inference.",
      recommendedAction: {
        kind: "configure_vercel_token",
        summary: "Add Vercel API access for the system before trusting deployment diagnosis.",
      },
      verified,
      inferred,
      blocked,
    }
  }

  if (vercel.apiStatus === "blocked") {
    blocked.push("Vercel API evidence is currently blocked or unavailable.")
    return {
      code: "vercel_api_blocked",
      summary: "The investigation could reach the Vercel integration path, but the API did not return usable deployment data.",
      likelyCause: "The Vercel API call failed, was denied, or returned an unusable response for this linked project.",
      nextStep: "Inspect the Vercel integration state and API access, then re-run the deployment investigation before attempting broader remediation.",
      recommendedAction: {
        kind: "inspect_vercel_api_access",
        summary: "Inspect Vercel API access or linked-project permissions before trying remediation.",
      },
      verified,
      inferred,
      blocked,
    }
  }

  if (vercel.ready && vercel.stageDeployment) {
    verified.push("Vercel returned a READY stage preview deployment.")
    return {
      code: "stage_preview_verified",
      summary: "The stage preview is now externally verified by Vercel.",
      likelyCause: "The linked Vercel project reports a ready deployment for the stage branch.",
      nextStep: "Use the verified preview URL as deployment proof and continue product work.",
      recommendedAction: {
        kind: "continue_with_verified_preview",
        summary: "Use the verified stage preview as proof and move back to product work.",
      },
      deploymentDetails: summarizeDeploymentDetails(vercel.stageDeployment, branch),
      verified,
      inferred,
      blocked,
    }
  }

  if (vercel.stageDeployment) {
    inferred.push(`Vercel knows about a stage deployment, but it is currently ${vercel.stageDeployment.state || "not ready"}.`)
    return {
      code: "stage_preview_not_ready",
      summary: "Vercel can see the stage deployment, but the preview is not ready yet.",
      likelyCause: "The deployment trigger fired, but the resulting preview has not reached a READY state yet.",
      nextStep: actions.some((action) => action.status === "completed")
        ? "Re-check Vercel after the remediation to see whether the deployment becomes READY."
        : "Wait for the deployment to become READY, or inspect the deployment state more deeply if it stalls.",
      recommendedAction: {
        kind: "wait_for_vercel_ready",
        summary: "Keep the remediation narrow and re-check until the current Vercel deployment becomes READY.",
      },
      deploymentDetails: summarizeDeploymentDetails(vercel.stageDeployment, branch),
      verified,
      inferred,
      blocked,
    }
  }

  if (!github.stageBranchSha) {
    return {
      code: "missing_github_stage_branch",
      summary: "The deployment path is blocked before Vercel because GitHub does not show a stage branch upstream.",
      likelyCause: "The stage branch has not been pushed cleanly to GitHub yet, or the remote branch state is not what the local repo expects.",
      nextStep: "Confirm the stage branch exists upstream on GitHub before blaming Vercel for the missing preview deployment.",
      recommendedAction: {
        kind: "push_stage_branch",
        summary: "Push or restore the stage branch upstream before expecting Vercel to build from it.",
      },
      verified,
      inferred,
      blocked,
    }
  }

  inferred.push("GitHub has the stage branch, but Vercel has not surfaced a matching preview deployment.")
  return {
    code: "missing_stage_preview_deployment",
    summary: "The branch exists upstream, but Vercel still has no matching stage preview deployment.",
    likelyCause: "GitHub has the stage branch, but Vercel has not surfaced a matching preview deployment yet.",
    nextStep: actions.some((action) => action.status === "completed")
      ? "Re-check Vercel for the new stage preview deployment and capture the preview URL once it appears."
      : "Inspect Vercel deployment state for stage, and only if no preview exists after GitHub is confirmed, consider a fresh low-risk trigger from stage.",
    recommendedAction: {
      kind: "trigger_stage_deployment",
      summary: actions.some((action) => action.status === "completed")
        ? "Re-check for the new Vercel preview after the last narrow trigger."
        : "Use the narrowest safe trigger to force a stage deployment only after GitHub is confirmed.",
    },
    verified,
    inferred,
    blocked,
  }
}

async function runProjectInvestigation(projectDir, projectName, options = {}) {
  const branch = options.branch || "stage"
  const attemptRemediation = options.attemptRemediation !== false

  const localGit = await getLocalGitEvidence(projectDir)
  const github = await getGitHubEvidence(projectDir)
  let vercel = await getVercelEvidence(projectDir, branch)
  const actions = []

  if (attemptRemediation && !vercel.ready) {
    const remediation = await maybePushStageBranch(projectDir, localGit, github, vercel)
    actions.push(remediation.action)
    if (remediation.attempted) {
      vercel = await getVercelEvidence(projectDir, branch)
    }
  }

  const trustChecks = [...localGit.trustChecks, ...github.trustChecks, ...vercel.trustChecks]
  const evidence = [...localGit.evidence, ...github.evidence, ...vercel.evidence]
  const diagnosis = deriveInvestigationDiagnosis({
    git: localGit,
    github,
    vercel,
    actions,
    branch,
  })
  const hasConfirmedPreview = diagnosis.code === "stage_preview_verified"
  const hasBlockedRemediation = actions.some((action) => action.status === "blocked")

  const record = {
    projectName,
    generatedAt: new Date().toISOString(),
    status: hasConfirmedPreview ? "healthy" : hasBlockedRemediation ? "blocked" : "needs_attention",
    title: hasConfirmedPreview ? "Stage preview verified" : "Investigate missing stage preview",
    summary: diagnosis.summary,
    likelyCause: diagnosis.likelyCause,
    nextStep: diagnosis.nextStep,
    diagnosisCode: diagnosis.code,
    recommendedAction: diagnosis.recommendedAction,
    deploymentDetails: diagnosis.deploymentDetails,
    proofSummary: {
      verified: diagnosis.verified,
      inferred: diagnosis.inferred,
      blocked: diagnosis.blocked,
    },
    canAutofix: !hasConfirmedPreview,
    suggestedInstruction: buildSuggestedInstruction(projectName),
    checks: summarizeChecks(evidence),
    evidence,
    actions,
    trustChecks,
  }

  const filePath = getInvestigationFilePath(projectDir, projectName)
  await ensureDir(filePath)
  await fs.writeFile(filePath, JSON.stringify(record, null, 2) + "\n", "utf8")

  return { filePath, record }
}

module.exports = {
  deriveInvestigationDiagnosis,
  getInvestigationFilePath,
  runProjectInvestigation,
}
