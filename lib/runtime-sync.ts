"use client"

import { getSupabaseBrowserClient } from "@/lib/supabase/client"
import { mapStoredEventToRuntimeMutation, type RuntimeMutationEvent, type StoredRuntimeEventRow } from "@/lib/runtime-event-types"

const LOCAL_EVENT_NAME = "command-center-runtime-sync"

export function publishRuntimeMutation(event: Omit<RuntimeMutationEvent, "timestamp">) {
  if (typeof window === "undefined") return

  const payload: RuntimeMutationEvent = {
    ...event,
    timestamp: Date.now(),
  }

  window.dispatchEvent(new CustomEvent<RuntimeMutationEvent>(LOCAL_EVENT_NAME, { detail: payload }))
}

export function subscribeToRuntimeMutations(callback: (event: RuntimeMutationEvent) => void) {
  if (typeof window === "undefined") {
    return () => {}
  }

  const handleLocal = (event: Event) => {
    const customEvent = event as CustomEvent<RuntimeMutationEvent>
    if (customEvent.detail) {
      callback(customEvent.detail)
    }
  }

  window.addEventListener(LOCAL_EVENT_NAME, handleLocal as EventListener)

  const supabase = getSupabaseBrowserClient()
  const channel = supabase
    ?.channel(`command-center-events-${Math.random().toString(36).slice(2)}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "events" },
      (payload) => callback(mapStoredEventToRuntimeMutation(payload.new as StoredRuntimeEventRow)),
    )

  channel?.subscribe()

  return () => {
    window.removeEventListener(LOCAL_EVENT_NAME, handleLocal as EventListener)
    if (channel && supabase) {
      void supabase.removeChannel(channel)
    }
  }
}
