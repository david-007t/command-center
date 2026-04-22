"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

const navItems = [
  { label: "Dashboard", href: "/" },
  { label: "Operations", href: "/operations" },
  { label: "Projects", href: "/projects" },
  { label: "New idea", href: "/intake" },
  { label: "Scout", href: "/scout" },
  { label: "Feedback", href: "/feedback" },
  { label: "System", href: "/system" },
]

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/"
  return pathname.startsWith(href)
}

export function SidebarNav() {
  const pathname = usePathname()

  return (
    <nav
      className="flex w-[220px] shrink-0 flex-col gap-6 border-r border-slate-800 bg-[#020617] px-5 py-7"
      style={{ minHeight: "100vh" }}
    >
      {/* Logo + title */}
      <div>
        <div className="flex items-center gap-2.5">
          <div
            className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[7px]"
            style={{
              background: "linear-gradient(135deg, #0ea5e9, #0369a1)",
              boxShadow: "0 0 0 1px rgba(56,189,248,0.3), inset 0 1px 0 rgba(255,255,255,0.2)",
            }}
          >
            <div className="h-2 w-2 rounded-sm bg-sky-100" />
          </div>
          <div>
            <p className="text-[9px] font-medium uppercase tracking-[0.22em] text-slate-500">System</p>
            <p className="mt-0.5 text-sm font-semibold tracking-tight text-slate-100">Command Center</p>
          </div>
        </div>
        <p className="mt-3.5 text-[11.5px] leading-[1.55] text-slate-500">
          Shared operating layer for Anelo, Leadqual, Pulse, and RBC.
        </p>
      </div>

      {/* Nav items */}
      <div className="flex flex-col gap-0.5">
        {navItems.map((item) => {
          const active = isActive(pathname, item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center justify-between rounded-lg border px-2.5 py-2 text-[13px] transition-colors ${
                active
                  ? "border-sky-500/20 bg-sky-500/8 font-medium text-sky-300"
                  : "border-transparent text-slate-400 hover:border-slate-800 hover:text-slate-200"
              }`}
              style={active ? { background: "rgba(56,189,248,0.08)" } : undefined}
            >
              {item.label}
            </Link>
          )
        })}
      </div>

      {/* Operator card */}
      <div className="mt-auto rounded-[10px] border border-slate-800 p-3">
        <div className="flex items-center gap-2">
          <div className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-gradient-to-br from-slate-700 to-slate-800 text-[10px] font-semibold text-slate-300">
            D
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-slate-200">David O.</p>
            <p className="text-[10.5px] text-slate-500">CEO · Operator</p>
          </div>
        </div>
      </div>
    </nav>
  )
}
