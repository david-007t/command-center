import { ReactNode } from "react"
import "./globals.css"
import { SidebarNav } from "@/components/sidebar-nav"
import { RunnerStrip } from "@/components/runner-strip"
import { RuntimeNotificationCenter } from "@/components/runtime-notification-center"

export const metadata = {
  title: "Command Center",
  description: "CEO interface for the AI company operating system",
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="font-sans text-slate-100">
        <div className="flex min-h-screen">
          <SidebarNav />
          <div className="flex min-w-0 flex-1 flex-col">
            <RunnerStrip />
            <main className="min-w-0 flex-1 px-8 py-7">{children}</main>
          </div>
        </div>
        <RuntimeNotificationCenter />
      </body>
    </html>
  )
}
