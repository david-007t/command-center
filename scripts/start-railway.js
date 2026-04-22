const { spawn } = require("child_process")

const port = process.env.PORT || "3000"

const child = spawn("npx", ["next", "start", "-p", port], {
  stdio: "inherit",
  env: process.env,
})

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 0)
})
