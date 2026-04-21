"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { subscribeToRuntimeMutations } from "@/lib/runtime-sync"
import {
  buildRuntimeNotification,
  mergeRuntimeNotifications,
  shouldSuppressRuntimeNotification,
  type RuntimeNotification,
} from "@/lib/runtime-notification-center"

const DISMISS_AFTER_MS = 12000

function hrefForNotification(notification: RuntimeNotification) {
  if (!notification.projectName) return "/"
  return `/projects/${notification.projectName}/work`
}

export function RuntimeNotificationCenter() {
  const [notifications, setNotifications] = useState<RuntimeNotification[]>([])
  const pathname = usePathname()
  const visibleNotifications = notifications.filter((notification) => !shouldSuppressRuntimeNotification(pathname, notification))

  useEffect(() => {
    const unsubscribe = subscribeToRuntimeMutations((event) => {
      const notification = buildRuntimeNotification(event)
      if (shouldSuppressRuntimeNotification(pathname, notification)) {
        return
      }
      setNotifications((current) => mergeRuntimeNotifications(current, notification))
    })

    return unsubscribe
  }, [pathname])

  useEffect(() => {
    if (!notifications.length) return

    const timers = notifications.map((notification) =>
      window.setTimeout(() => {
        setNotifications((current) => current.filter((item) => item.id !== notification.id))
      }, DISMISS_AFTER_MS),
    )

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer))
    }
  }, [notifications])

  if (!visibleNotifications.length) return null

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-3">
      {visibleNotifications.map((notification) => (
        <div
          key={notification.id}
          className="pointer-events-auto rounded-xl border border-sky-400/30 bg-slate-950/95 p-4 shadow-2xl shadow-slate-950/40"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.3em] text-sky-300">
                {notification.projectName ? `${notification.projectName} update` : "System update"}
              </p>
              <p className="mt-2 text-sm font-medium text-white">{notification.title}</p>
            </div>
            <button
              type="button"
              className="rounded-md px-2 py-1 text-xs text-slate-400 transition hover:bg-slate-900 hover:text-white"
              onClick={(event) => {
                event.preventDefault()
                setNotifications((current) => current.filter((item) => item.id !== notification.id))
              }}
            >
              Dismiss
            </button>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-300">{notification.message}</p>
          <Link
            href={hrefForNotification(notification)}
            className="mt-3 inline-block text-xs text-slate-500 transition hover:text-sky-300"
          >
            Open {notification.projectName ? `${notification.projectName} work view` : "dashboard"}
          </Link>
        </div>
      ))}
    </div>
  )
}
