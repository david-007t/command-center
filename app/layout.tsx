import { promises as fs } from "fs"
import path from "path"
import Link from "next/link"
import { ReactNode } from "react"
import "./globals.css"
import { Badge } from "@/components/ui/badge"
import { RuntimeNotificationCenter } from "@/components/runtime-notification-center"
import { summarizeUsage } from "@/lib/usage-telemetry"

export const metadata = {
  title: "Command Center",
  description: "CEO interface for the AI company operating system",
}

const navItems = [
  { href: "/", label: "Dashboard" },
  { href: "/intake", label: "New Idea" },
  { href: "/projects", label: "Projects" },
  { href: "/scout", label: "Scout" },
]

async function getSystemMeta() {
  const developerPath = process.env.DEVELOPER_PATH
  if (!developerPath) {
    return {
      templatesVersion: "1.0",
      orchestratorLastActive: "DEVELOPER_PATH not configured",
      usage: null,
    }
  }

  const runtimeSummary = path.join(developerPath, "_system", "reports", "runtime_summary.md")
  const stats = await fs.stat(runtimeSummary).catch(() => null)

  return {
    templatesVersion: "1.0",
    orchestratorLastActive: stats ? stats.mtime.toISOString() : "pending first run",
    usage: await summarizeUsage(developerPath).catch(() => null),
  }
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const systemMeta = await getSystemMeta()

  return (
    <html lang="en" className="dark">
      <body className="font-sans text-slate-100">
        <div className="min-h-screen lg:grid lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="border-b border-slate-800 bg-slate-950/80 px-6 py-8 backdrop-blur lg:min-h-screen lg:border-b-0 lg:border-r">
            <div className="space-y-8">
              <div>
                <p className="text-xs uppercase tracking-[0.4em] text-sky-300">System</p>
                <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white">Command Center</h1>
                <p className="mt-2 text-sm text-slate-400">Shared operating layer for Anelo, Leadqual, Pulse, and RBC.</p>
              </div>

              <nav className="space-y-2">
                {navItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="block rounded-lg px-3 py-3 text-sm text-slate-300 transition hover:bg-slate-900 hover:text-white"
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
            </div>
          </aside>

          <main className="min-w-0">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-6 py-4 lg:px-8">
              <div className="flex flex-wrap items-center gap-3">
                <Badge tone="purple">System version {systemMeta.templatesVersion}</Badge>
                <Badge tone="green">Operating mode: Stable</Badge>
                <Badge tone="neutral">Last orchestrator run: {systemMeta.orchestratorLastActive}</Badge>
                {systemMeta.usage ? (
                  <Badge tone="amber">
                    Weekly usage: {systemMeta.usage.weekly.totalTokens.toLocaleString()} tokens · ${systemMeta.usage.weekly.estimatedCostUsd.toFixed(2)}
                  </Badge>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Badge tone="amber">
                  Estimated API cost this month: {systemMeta.usage ? `$${systemMeta.usage.monthly.estimatedCostUsd.toFixed(2)}` : "pending"}
                </Badge>
                <Badge tone="neutral">
                  Codex weekly limit: {systemMeta.usage?.codexDesktop.weeklyLimitStatus ?? "unavailable"}
                </Badge>
              </div>
            </header>
            <div className="px-6 py-8 lg:px-8">{children}</div>
          </main>
        </div>
        <RuntimeNotificationCenter />
      </body>
    </html>
  )
}
