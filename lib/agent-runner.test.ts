import test from "node:test"
import assert from "node:assert/strict"

import { chooseWorkerAgentEngine, resolveClaudeAgentMaxTurns, runClaudeAgent } from "./agent-runner.ts"

async function* fakeQuery() {
  yield {
    type: "assistant",
    message: {
      content: [
        {
          type: "text",
          text: "I am editing the project now.",
        },
      ],
    },
  }
  yield {
    type: "result",
    subtype: "success",
    result: "Outcome\nImplemented the requested change.\n\nVerification\nRan the focused checks.",
    total_cost_usd: 0.02,
    num_turns: 2,
  }
}

test("runClaudeAgent executes through the Claude Agent SDK query stream", async () => {
  const calls: unknown[] = []
  const activity: string[] = []
  const result = await runClaudeAgent({
    prompt: "Do the work",
    workingDirectory: "/tmp/project",
    runId: "run-1",
    env: {
      ANTHROPIC_API_KEY: "test-key",
      NODE_ENV: "test",
      PATH: "/usr/bin",
    },
    queryImpl: (params) => {
      calls.push(params)
      return fakeQuery()
    },
    onActivity: (line) => {
      activity.push(line)
    },
  })

  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], {
    prompt: "Do the work",
    options: {
      cwd: "/tmp/project",
        env: {
          ANTHROPIC_API_KEY: "test-key",
          NODE_ENV: "test",
          PATH: "/usr/bin",
          CLAUDE_AGENT_SDK_CLIENT_APP: "command-center/worker",
        },
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      tools: { type: "preset", preset: "claude_code" },
      settingSources: ["user", "project", "local"],
      includePartialMessages: true,
      maxTurns: 80,
    },
  })
  assert.equal(result.exitCode, 0)
  assert.match(result.messagePreview, /Outcome/)
  assert.match(result.logPreview, /I am editing the project now/)
  assert.match(result.logPreview, /"type":"result"/)
  assert.ok(activity.some((line) => /editing the project/i.test(line)))
  assert.ok(activity.some((line) => /finished successfully/i.test(line)))
})

test("chooseWorkerAgentEngine defaults new project work to claude", () => {
  assert.equal(chooseWorkerAgentEngine({}), "claude")
  assert.equal(chooseWorkerAgentEngine({ WORKER_AGENT_ENGINE: "codex" }), "codex")
})

test("resolveClaudeAgentMaxTurns defaults above short implementation tasks and accepts env override", () => {
  assert.equal(resolveClaudeAgentMaxTurns({}), 80)
  assert.equal(resolveClaudeAgentMaxTurns({ WORKER_AGENT_MAX_TURNS: "120" }), 120)
  assert.equal(resolveClaudeAgentMaxTurns({ WORKER_AGENT_MAX_TURNS: "0" }), 80)
  assert.equal(resolveClaudeAgentMaxTurns({ WORKER_AGENT_MAX_TURNS: "nope" }), 80)
})
