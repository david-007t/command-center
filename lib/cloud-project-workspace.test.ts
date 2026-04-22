import assert from "assert/strict"
import { mkdir, mkdtemp, rm } from "fs/promises"
import os from "os"
import path from "path"
import test from "node:test"

import { CloudProjectWorkspaceError, ensureProjectWorkspace } from "./cloud-project-workspace.ts"

test("ensureProjectWorkspace leaves local missing project paths alone outside Railway", async () => {
  const developerPath = await mkdtemp(path.join(os.tmpdir(), "cc-workspace-local-"))
  try {
    assert.equal(
      await ensureProjectWorkspace({
        developerPath,
        projectName: "rbc",
        env: {},
      }),
      path.join(developerPath, "rbc"),
    )
  } finally {
    await rm(developerPath, { recursive: true, force: true })
  }
})

test("ensureProjectWorkspace reports missing cloud repository config", async () => {
  const developerPath = await mkdtemp(path.join(os.tmpdir(), "cc-workspace-cloud-"))
  try {
    await assert.rejects(
      ensureProjectWorkspace({
        developerPath,
        projectName: "rbc",
        env: {
          RAILWAY_ENVIRONMENT: "production",
        },
      }),
      (error) => {
        assert.equal(error instanceof CloudProjectWorkspaceError, true)
        assert.match((error as Error).message, /No cloud repository is configured for rbc/)
        return true
      },
    )
  } finally {
    await rm(developerPath, { recursive: true, force: true })
  }
})

test("ensureProjectWorkspace honors PROJECT_REPOSITORIES_JSON for configured cloud repos", async () => {
  const developerPath = await mkdtemp(path.join(os.tmpdir(), "cc-workspace-existing-"))
  const projectDir = path.join(developerPath, "rbc")
  try {
    await mkdir(projectDir)
    assert.equal(
      await ensureProjectWorkspace({
        developerPath,
        projectName: "rbc",
        env: {
          RAILWAY_ENVIRONMENT: "production",
          PROJECT_REPOSITORIES_JSON: JSON.stringify({ rbc: "https://example.com/rbc.git" }),
        },
      }),
      projectDir,
    )
  } finally {
    await rm(developerPath, { recursive: true, force: true })
  }
})
