import test from "node:test"
import assert from "node:assert/strict"
import { getVercelProjectRef, getVercelDeploymentLinks } from "./vercel-deployments.ts"

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 401,
    json: async () => body,
  } as Response
}

test("getVercelProjectRef uses per-project env mapping before discovery", async () => {
  const ref = await getVercelProjectRef({
    projectName: "leadqual",
    projectDir: "/missing",
    env: {
      VERCEL_PROJECT_ID_LEADQUAL: "prj_leadqual",
      VERCEL_TEAM_ID: "team_123",
    },
    fetchImpl: async () => jsonResponse({ projects: [] }),
  })

  assert.deepEqual(ref, { projectId: "prj_leadqual", teamId: "team_123" })
})

test("getVercelProjectRef discovers a close Vercel project name match", async () => {
  const ref = await getVercelProjectRef({
    projectName: "leadqual",
    projectDir: "/missing",
    env: {
      VERCEL_TOKEN: "token",
    },
    fetchImpl: async () =>
      jsonResponse({
        projects: [
          { id: "prj_other", name: "other-app" },
          { id: "prj_leadqual", name: "lead-qualifier-ten" },
        ],
      }),
  })

  assert.deepEqual(ref, { projectId: "prj_leadqual", teamId: null })
})

test("getVercelDeploymentLinks returns production and stage links from Vercel deployments", async () => {
  const seenUrls = [] as string[]
  const links = await getVercelDeploymentLinks({
    projectName: "leadqual",
    projectDir: "/missing",
    env: {
      VERCEL_TOKEN: "token",
      VERCEL_PROJECT_ID_LEADQUAL: "prj_leadqual",
      VERCEL_STAGE_BRANCH_LEADQUAL: "stage",
    },
    fetchImpl: async (url) => {
      seenUrls.push(String(url))
      if (String(url).includes("/domains")) {
        return jsonResponse({
          domains: [{ name: "lead-qualifier-ten.vercel.app", verified: true }],
        })
      }

      if (String(url).includes("target=production")) {
        return jsonResponse({
          deployments: [
            {
              uid: "dep_prod",
              state: "READY",
              target: "production",
              url: "lead-qualifier-ten-git-main.vercel.app",
              alias: ["lead-qualifier-ten.vercel.app"],
              createdAt: 1776800000000,
            },
          ],
        })
      }

      return jsonResponse({
        deployments: [
          {
            uid: "dep_stage",
            state: "READY",
            target: "preview",
            url: "lead-qualifier-ten-git-stage.vercel.app",
            meta: { githubCommitRef: "stage" },
            createdAt: 1776800100000,
          },
        ],
      })
    },
  })

  assert.match(seenUrls[0] ?? "", /projectId=prj_leadqual/)
  assert.equal(links.production?.url, "https://lead-qualifier-ten.vercel.app")
  assert.equal(links.stage?.url, "https://lead-qualifier-ten-git-stage.vercel.app")
})

test("getVercelDeploymentLinks returns null links when Vercel auth is unavailable", async () => {
  const links = await getVercelDeploymentLinks({
    projectName: "leadqual",
    projectDir: "/missing",
    env: {},
    fetchImpl: async () => {
      throw new Error("fetch should not be called")
    },
  })

  assert.deepEqual(links, { production: null, stage: null })
})

test("getVercelDeploymentLinks returns configured product links without Vercel auth", async () => {
  const links = await getVercelDeploymentLinks({
    projectName: "leadqual",
    projectDir: "/missing",
    env: {
      VERCEL_PRODUCT_URL_LEADQUAL: "https://lead-qualifier-ten.vercel.app/",
      VERCEL_STAGE_URL_LEADQUAL: "https://lead-qualifier-ten-git-stage.vercel.app",
    },
    fetchImpl: async () => {
      throw new Error("fetch should not be called")
    },
  })

  assert.equal(links.production?.url, "https://lead-qualifier-ten.vercel.app")
  assert.equal(links.production?.source, "config")
  assert.equal(links.stage?.url, "https://lead-qualifier-ten-git-stage.vercel.app")
  assert.equal(links.stage?.source, "config")
})
