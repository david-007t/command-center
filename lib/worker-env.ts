import { promises as fs } from "fs"
import path from "path"
import { resolveWorkerSecrets } from "./runtime-secrets"

function parseEnvFile(content: string) {
  const parsed: Record<string, string> = {}
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue

    const separatorIndex = line.indexOf("=")
    if (separatorIndex <= 0) continue

    const key = line.slice(0, separatorIndex).trim()
    let value = line.slice(separatorIndex + 1).trim()
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    parsed[key] = value
  }
  return parsed
}

async function readEnvFile(filePath: string) {
  try {
    return parseEnvFile(await fs.readFile(filePath, "utf8"))
  } catch {
    return {}
  }
}

export async function loadWorkerEnv(
  projectDir: string,
  baseEnv: NodeJS.ProcessEnv = process.env,
  options?: {
    resolveSecrets?: typeof resolveWorkerSecrets
  },
) {
  const mergedEnv = { ...baseEnv }
  const resolveSecrets = options?.resolveSecrets ?? resolveWorkerSecrets
  const envSources = [path.join(projectDir, ".env"), path.join(projectDir, ".env.local")]

  const secretEnv = await resolveSecrets(baseEnv)
  for (const [key, value] of Object.entries(secretEnv)) {
    if ((mergedEnv[key] == null || mergedEnv[key] === "") && value) {
      mergedEnv[key] = value
    }
  }

  for (const filePath of envSources) {
    const fileEnv = await readEnvFile(filePath)
    for (const [key, value] of Object.entries(fileEnv)) {
      if (mergedEnv[key] == null || mergedEnv[key] === "") {
        mergedEnv[key] = value
      }
    }
  }

  return mergedEnv
}
