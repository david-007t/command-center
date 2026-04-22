const { spawn } = require("node:child_process")

const serviceName = process.env.RAILWAY_SERVICE_NAME || ""
const processType = process.env.COMMAND_CENTER_PROCESS || ""
const isRunner = processType === "runner" || serviceName.includes("runner")

function run(command, args) {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  })

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal)
      return
    }
    process.exit(code ?? 1)
  })
}

if (isRunner) {
  const appOrigin = process.env.COMMAND_CENTER_APP_ORIGIN
  if (!appOrigin) {
    console.error("COMMAND_CENTER_APP_ORIGIN is required for the Railway runner service.")
    process.exit(1)
  }

  run("npx", [
    "inngest-cli@latest",
    "dev",
    "--host",
    "0.0.0.0",
    "--port",
    process.env.PORT || "8288",
    "--sdk-url",
    `${appOrigin.replace(/\/$/, "")}/api/inngest`,
  ])
} else {
  run("next", ["start", "-p", process.env.PORT || "3000"])
}
