import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { spawn } from "child_process"

import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk"

const codexPath = "/Applications/Codex.app/Contents/Resources/codex"

export type WorkerAgentEngine = "claude" | "codex"

type QueryParams = Parameters<typeof query>[0]
type QueryImpl = (params: QueryParams) => AsyncIterable<SDKMessage | Record<string, unknown>>

export type AgentRunResult = {
  exitCode: number
  messagePreview: string
  logPreview: string
}

export type AgentActivityCallback = (line: string) => void | Promise<void>

export function chooseWorkerAgentEngine(env: Record<string, string | undefined> = process.env): WorkerAgentEngine {
  return env.WORKER_AGENT_ENGINE === "codex" ? "codex" : "claude"
}

export function resolveClaudeAgentMaxTurns(env: Record<string, string | undefined> = process.env) {
  const parsed = Number(env.WORKER_AGENT_MAX_TURNS)
  if (Number.isInteger(parsed) && parsed > 0) return parsed
  return 80
}

function withSdkClientEnv(env: NodeJS.ProcessEnv) {
  return {
    ...env,
    CLAUDE_AGENT_SDK_CLIENT_APP: env.CLAUDE_AGENT_SDK_CLIENT_APP ?? "command-center/worker",
  }
}

function assistantText(message: unknown) {
  if (!message || typeof message !== "object") return ""
  const content = (message as { content?: unknown }).content
  if (!Array.isArray(content)) return ""

  return content
    .map((item) => {
      if (!item || typeof item !== "object") return ""
      const block = item as { type?: unknown; text?: unknown; name?: unknown }
      if (block.type === "text" && typeof block.text === "string") return block.text
      if (block.type === "tool_use" && typeof block.name === "string") return `Tool use: ${block.name}`
      return ""
    })
    .filter(Boolean)
    .join("\n")
}

function assistantActivityLines(message: unknown) {
  if (!message || typeof message !== "object") return []
  const content = (message as { content?: unknown }).content
  if (!Array.isArray(content)) return []

  return content
    .map((item) => {
      if (!item || typeof item !== "object") return ""
      const block = item as { type?: unknown; text?: unknown; name?: unknown }
      if (block.type === "tool_use" && typeof block.name === "string") return `Using ${block.name}.`
      if (block.type === "text" && typeof block.text === "string") {
        return block.text
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 240)
      }
      return ""
    })
    .filter(Boolean)
}

export async function runClaudeAgent(params: {
  prompt: string
  workingDirectory: string
  runId: string
  env: NodeJS.ProcessEnv
  queryImpl?: QueryImpl
  onActivity?: AgentActivityCallback
}): Promise<AgentRunResult> {
  const queryImpl = params.queryImpl ?? query
  const logLines: string[] = []
  let messagePreview = ""
  let exitCode = 1

  try {
    const stream = queryImpl({
      prompt: params.prompt,
      options: {
        cwd: params.workingDirectory,
        env: withSdkClientEnv(params.env),
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        tools: { type: "preset", preset: "claude_code" },
        settingSources: ["user", "project", "local"],
        includePartialMessages: true,
        maxTurns: resolveClaudeAgentMaxTurns(params.env),
      },
    })

    for await (const message of stream) {
      const serialized = JSON.stringify(message)
      if (serialized) logLines.push(serialized)

      if (message.type === "assistant") {
        const text = assistantText((message as { message?: unknown }).message)
        if (text) logLines.push(text)
        for (const line of assistantActivityLines((message as { message?: unknown }).message)) {
          await params.onActivity?.(line)
        }
      }

      if (message.type === "result") {
        if (message.subtype === "success") {
          messagePreview = typeof message.result === "string" ? message.result : ""
          exitCode = message.is_error ? 1 : 0
          await params.onActivity?.(message.is_error ? "Worker finished with an error." : "Worker finished successfully.")
        } else {
          const errorMessage = message as { subtype?: string; errors?: unknown }
          const errors = Array.isArray(errorMessage.errors) ? errorMessage.errors.join("\n") : ""
          messagePreview = errors || `Claude Agent SDK finished with ${message.subtype}.`
          exitCode = 1
          await params.onActivity?.(messagePreview)
        }
      }
    }
  } catch (error) {
    messagePreview = error instanceof Error ? error.message : "Claude Agent SDK execution failed."
    logLines.push(messagePreview)
    await params.onActivity?.(messagePreview)
    exitCode = 1
  }

  return {
    exitCode,
    messagePreview,
    logPreview: logLines.join("\n"),
  }
}

async function runCodexAgent(params: {
  prompt: string
  workingDirectory: string
  runId: string
  env: NodeJS.ProcessEnv
  onActivity?: AgentActivityCallback
}): Promise<AgentRunResult> {
  const outputDir = path.join(os.tmpdir(), "command-center-inngest")
  await fs.mkdir(outputDir, { recursive: true })
  const messagePath = path.join(outputDir, `${params.runId}.md`)
  const logChunks: string[] = []
  const nodeDir = path.dirname(process.execPath)
  const currentPath = params.env.PATH || process.env.PATH || ""
  const pathEntries = currentPath.split(path.delimiter).filter(Boolean)
  const env = {
    ...params.env,
    PATH: [nodeDir, ...pathEntries.filter((entry) => entry !== nodeDir)].join(path.delimiter),
  }

  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(
      codexPath,
      [
        "exec",
        "--skip-git-repo-check",
        "--dangerously-bypass-approvals-and-sandbox",
        "--cd",
        params.workingDirectory,
        "--output-last-message",
        messagePath,
        params.prompt,
      ],
      {
        cwd: params.workingDirectory,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    )

    child.stdout?.on("data", (chunk) => {
      const text = chunk.toString()
      logChunks.push(text)
      void params.onActivity?.(text.split("\n").filter(Boolean).slice(-1)[0] ?? "Codex worker wrote output.")
    })
    child.stderr?.on("data", (chunk) => {
      const text = chunk.toString()
      logChunks.push(text)
      void params.onActivity?.(text.split("\n").filter(Boolean).slice(-1)[0] ?? "Codex worker wrote diagnostics.")
    })
    child.on("error", reject)
    child.on("close", (code) => resolve(code ?? 1))
  })

  return {
    exitCode,
    messagePreview: await fs.readFile(messagePath, "utf8").catch(() => ""),
    logPreview: logChunks.join(""),
  }
}

export async function runWorkerAgent(params: {
  prompt: string
  workingDirectory: string
  runId: string
  baseEnv?: NodeJS.ProcessEnv
  onActivity?: AgentActivityCallback
}) {
  const { loadWorkerEnv } = await import("./worker-env")
  const workerEnv = await loadWorkerEnv(params.workingDirectory, params.baseEnv ?? process.env)
  const engine = chooseWorkerAgentEngine(workerEnv)

  if (engine === "codex") {
    return runCodexAgent({
      prompt: params.prompt,
      workingDirectory: params.workingDirectory,
      runId: params.runId,
      env: workerEnv,
      onActivity: params.onActivity,
    })
  }

  return runClaudeAgent({
    prompt: params.prompt,
    workingDirectory: params.workingDirectory,
    runId: params.runId,
    env: workerEnv,
    onActivity: params.onActivity,
  })
}
