import test from "node:test"
import assert from "node:assert/strict"
import { buildSystemImprovementsMarkdown } from "./system-improvements-markdown.ts"

test("buildSystemImprovementsMarkdown groups open and resolved items for command-center self-heal tracking", () => {
  const markdown = buildSystemImprovementsMarkdown([
    {
      id: "1",
      createdAt: "2026-04-15T12:00:00.000Z",
      scope: "system",
      projectName: "command-center",
      category: "self_heal",
      severity: "high",
      summary: "Trust summary is too vague.",
      desiredOutcome: "Trust reporting becomes evidence-first.",
      status: "actioning",
      source: "chat",
      relatedJobId: "job_1",
      resolutionNote: "Project worker launched.",
    },
    {
      id: "2",
      createdAt: "2026-04-14T12:00:00.000Z",
      scope: "system",
      projectName: "command-center",
      category: "product_improvement",
      severity: "medium",
      summary: "Project pages need clearer self-management framing.",
      desiredOutcome: "Command Center reads like a first-class managed project.",
      status: "resolved",
      source: "chat",
      relatedJobId: "job_2",
      resolutionNote: "Completed in Pass 4.",
    },
  ])

  assert.match(markdown, /Current improvement focus/i)
  assert.match(markdown, /Trust summary is too vague/i)
  assert.match(markdown, /Recently resolved/i)
  assert.match(markdown, /Completed in Pass 4/i)
})
