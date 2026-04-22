import test from "node:test"
import assert from "node:assert/strict"
import {
  extractDeploymentUrls,
  mergeProjectDeploymentLinks,
  projectLinkFromUrl,
} from "./project-deployment-links.ts"

test("extractDeploymentUrls finds normalized product URLs in worker output", () => {
  const urls = extractDeploymentUrls(`
Worker finished.
Product: https://lead-qualifier-ten.vercel.app
Other text: https://lead-qualifier-ten.vercel.app/
Local: http://127.0.0.1:5173
`)

  assert.deepEqual(urls, ["https://lead-qualifier-ten.vercel.app", "http://127.0.0.1:5173"])
})

test("mergeProjectDeploymentLinks backfills production from latest worker output", () => {
  const links = mergeProjectDeploymentLinks({
    existing: { production: null, stage: null },
    resolved: { production: null, stage: null },
    workerText: ["Run complete. Test https://lead-qualifier-ten.vercel.app and report back."],
  })

  assert.equal(links.production?.url, "https://lead-qualifier-ten.vercel.app")
  assert.equal(links.production?.source, "worker")
  assert.equal(links.stage, null)
})

test("mergeProjectDeploymentLinks keeps an existing product link when refresh has no fresh evidence", () => {
  const existing = projectLinkFromUrl("https://lead-qualifier-ten.vercel.app", "worker", "production")

  const links = mergeProjectDeploymentLinks({
    existing: { production: existing, stage: null },
    resolved: { production: null, stage: null },
    workerText: ["No deployment URL was reported this time."],
  })

  assert.deepEqual(links.production, existing)
})

test("mergeProjectDeploymentLinks prefers resolver links over worker fallbacks and preserves stored stage", () => {
  const storedStage = projectLinkFromUrl("https://lead-qualifier-ten-git-stage.vercel.app", "worker", "stage")
  const resolvedProduction = projectLinkFromUrl("https://lead-qualifier-ten.vercel.app", "vercel", "production")

  const links = mergeProjectDeploymentLinks({
    existing: { production: null, stage: storedStage },
    resolved: { production: resolvedProduction, stage: null },
    workerText: ["Older fallback https://lead-qualifier-ten-old.vercel.app"],
  })

  assert.equal(links.production, resolvedProduction)
  assert.equal(links.stage, storedStage)
})
