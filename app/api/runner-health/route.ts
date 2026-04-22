import { NextResponse } from "next/server"
import { ensureLocalWorkerRunner, isLocalWorkerRunnerAvailable } from "@/lib/dev-runner-health"

export const dynamic = "force-dynamic"

export async function GET() {
  const cloudRunnerUrl = process.env.INNGEST_DEV?.startsWith("http") ? process.env.INNGEST_DEV : ""
  if (cloudRunnerUrl) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2500)
    try {
      const response = await fetch(cloudRunnerUrl, {
        method: "GET",
        signal: controller.signal,
        cache: "no-store",
      })

      return NextResponse.json({
        runnerAvailable: response.ok,
        runnerState: response.ok ? "online" : "offline",
        runnerMode: "cloud",
        runnerUrl: cloudRunnerUrl,
      })
    } catch {
      return NextResponse.json({
        runnerAvailable: false,
        runnerState: "offline",
        runnerMode: "cloud",
        runnerUrl: cloudRunnerUrl,
      })
    } finally {
      clearTimeout(timeout)
    }
  }

  const runnerAvailable = await isLocalWorkerRunnerAvailable()
  return NextResponse.json({
    runnerAvailable,
    runnerState: runnerAvailable ? "online" : "offline",
    runnerMode: "local",
  })
}

export async function POST(request: Request) {
  if (process.env.INNGEST_DEV?.startsWith("http")) {
    return NextResponse.json({
      status: "ready",
      runnerAvailable: true,
      runnerState: "online",
      runnerMode: "cloud",
      message: "Cloud runner is configured for this deployment.",
    })
  }

  const origin = request.headers.get("origin")
  const requestOrigin = new URL(request.url).origin
  const endpointBase = origin?.startsWith("http") ? origin : requestOrigin
  const result = await ensureLocalWorkerRunner({
    inngestEndpoint: `${endpointBase}/api/inngest`,
  })

  return NextResponse.json(result)
}
