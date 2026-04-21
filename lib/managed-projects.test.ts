import test from "node:test"
import assert from "node:assert/strict"
import { COMMAND_CENTER_PROJECT, deriveCommandCenterPortfolioRecord, readPortfolioProjectsWithCommandCenter, resolveProjectDir } from "./managed-projects.ts"

test("resolveProjectDir keeps command-center at the workspace root", () => {
  const developerPath = "/tmp/developer"
  assert.equal(resolveProjectDir(developerPath, COMMAND_CENTER_PROJECT), process.cwd())
  assert.equal(resolveProjectDir(developerPath, "anelo"), "/tmp/developer/anelo")
})

test("readPortfolioProjectsWithCommandCenter synthesizes command-center when the portfolio row is missing", async () => {
  const developerPath = "/Users/ohsay22/Developer"
  const projects = await readPortfolioProjectsWithCommandCenter(
    developerPath,
    `| Name | Phase | Progress | Blocker | Next action | Launch target |
|------|-------|----------|---------|-------------|---------------|
| anelo | BUILD | 82% | blocker | next | 2026-04-30 |`,
  )

  assert.equal(projects[0]?.name, COMMAND_CENTER_PROJECT)
  assert.ok(projects.some((project) => project.name === "anelo"))
})

test("deriveCommandCenterPortfolioRecord reads the repo-root governance files", async () => {
  const project = await deriveCommandCenterPortfolioRecord("/Users/ohsay22/Developer")

  assert.equal(project.name, COMMAND_CENTER_PROJECT)
  assert.equal(project.phase, "BUILD")
  assert.ok(project.progress > 0)
  assert.match(project.nextAction, /Verify the new self-project runtime path|Finish Pass 4/i)
})
