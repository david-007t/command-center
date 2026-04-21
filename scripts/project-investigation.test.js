const test = require("node:test")
const assert = require("node:assert/strict")
const { deriveInvestigationDiagnosis } = require("./project-investigation.js")

function baseGit() {
  return {
    localStageSha: "abc1234",
    cleanWorktree: true,
  }
}

function baseGitHub() {
  return {
    stageBranchSha: "abc1234",
  }
}

function baseVercel() {
  return {
    linkedProject: {
      projectId: "prj_123",
      teamId: "team_123",
    },
    ready: false,
    stageDeployment: null,
    tokenConfigured: true,
    apiStatus: "ok",
  }
}

test("deriveInvestigationDiagnosis reports verified preview when Vercel returns a ready stage deployment", () => {
  const diagnosis = deriveInvestigationDiagnosis({
    git: baseGit(),
    github: baseGitHub(),
    vercel: {
      ...baseVercel(),
      ready: true,
      stageDeployment: { state: "READY", meta: { githubCommitSha: "abc1234" }, url: "anelo-stage.vercel.app", createdAt: 1713200000000 },
    },
    actions: [],
  })

  assert.equal(diagnosis.code, "stage_preview_verified")
  assert.match(diagnosis.summary, /verified/i)
  assert.ok(diagnosis.verified.some((item) => /Vercel returned a READY stage preview/i.test(item)))
  assert.equal(diagnosis.recommendedAction.kind, "continue_with_verified_preview")
  assert.equal(diagnosis.deploymentDetails?.state, "READY")
  assert.equal(diagnosis.deploymentDetails?.commitSha, "abc1234")
  assert.equal(diagnosis.deploymentDetails?.url, "https://anelo-stage.vercel.app")
})

test("deriveInvestigationDiagnosis reports missing stage preview deployment when GitHub has the branch but Vercel has no deployment", () => {
  const diagnosis = deriveInvestigationDiagnosis({
    git: baseGit(),
    github: baseGitHub(),
    vercel: baseVercel(),
    actions: [],
  })

  assert.equal(diagnosis.code, "missing_stage_preview_deployment")
  assert.match(diagnosis.likelyCause, /GitHub has the stage branch/i)
  assert.ok(diagnosis.inferred.some((item) => /Vercel has not surfaced a matching preview deployment/i.test(item)))
  assert.equal(diagnosis.recommendedAction.kind, "trigger_stage_deployment")
})

test("deriveInvestigationDiagnosis reports stage preview not ready when Vercel knows about the deployment", () => {
  const diagnosis = deriveInvestigationDiagnosis({
    git: baseGit(),
    github: baseGitHub(),
    vercel: {
      ...baseVercel(),
      stageDeployment: { state: "BUILDING", meta: { githubCommitSha: "def5678" }, url: "anelo-stage-build.vercel.app", createdAt: 1713200001000 },
    },
    actions: [],
  })

  assert.equal(diagnosis.code, "stage_preview_not_ready")
  assert.match(diagnosis.nextStep, /wait for the deployment to become READY|re-check/i)
  assert.equal(diagnosis.recommendedAction.kind, "wait_for_vercel_ready")
  assert.equal(diagnosis.deploymentDetails?.state, "BUILDING")
  assert.equal(diagnosis.deploymentDetails?.url, "https://anelo-stage-build.vercel.app")
})

test("deriveInvestigationDiagnosis reports missing GitHub stage branch before blaming Vercel", () => {
  const diagnosis = deriveInvestigationDiagnosis({
    git: baseGit(),
    github: {
      stageBranchSha: null,
    },
    vercel: baseVercel(),
    actions: [],
  })

  assert.equal(diagnosis.code, "missing_github_stage_branch")
  assert.ok(diagnosis.blocked.some((item) => /GitHub does not currently show a stage branch/i.test(item)))
  assert.equal(diagnosis.recommendedAction.kind, "push_stage_branch")
})

test("deriveInvestigationDiagnosis reports blocked Vercel API evidence separately", () => {
  const diagnosis = deriveInvestigationDiagnosis({
    git: baseGit(),
    github: baseGitHub(),
    vercel: {
      ...baseVercel(),
      apiStatus: "blocked",
    },
    actions: [],
  })

  assert.equal(diagnosis.code, "vercel_api_blocked")
  assert.ok(diagnosis.blocked.some((item) => /Vercel API evidence is currently blocked/i.test(item)))
  assert.equal(diagnosis.recommendedAction.kind, "inspect_vercel_api_access")
})
