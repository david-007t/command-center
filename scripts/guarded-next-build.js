const { execFileSync, spawnSync } = require("node:child_process")
const { realpathSync } = require("node:fs")
const { resolve } = require("node:path")

const cwd = realpathSync(process.cwd())

function activeNextDevProcesses() {
  const output = execFileSync("ps", ["-axo", "pid,command"], { encoding: "utf8" })

  return output
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => /next dev/.test(line) || /node .*next.* dev/.test(line))
}

const activeDevServer = activeNextDevProcesses().find((line) => {
  const command = line.replace(/^\d+\s+/, "")
  return command.includes(cwd) || command.includes(resolve(cwd, "node_modules/.bin/next")) || command.includes("next dev")
})

if (activeDevServer && process.env.ALLOW_BUILD_WITH_DEV_SERVER !== "1") {
  console.error("Refusing to run next build while a Next dev server is active for this workspace.")
  console.error("")
  console.error("Why: building and serving the same .next directory can make the browser load stale CSS/JS chunks.")
  console.error("Fix: stop the dev server first, or set ALLOW_BUILD_WITH_DEV_SERVER=1 if you intentionally isolated the build output.")
  console.error("")
  console.error(`Detected: ${activeDevServer}`)
  process.exit(1)
}

const result = spawnSync("next", ["build"], {
  stdio: "inherit",
  shell: process.platform === "win32",
})

process.exit(result.status ?? 1)
