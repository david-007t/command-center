import type { WorkOrderPlan, WorkOrderPriority } from "./work-order-planner.ts"

export type WorkOrderPlanStatus = "draft" | "ready" | "approved" | "sent_back"
export type StoredWorkOrderPlanStatus = Exclude<WorkOrderPlanStatus, "draft">
export type WorkOrderPlanKind = "master" | "sub_plan"

export type StoredWorkOrderPlan = {
  id: string
  kind: WorkOrderPlanKind
  goal: string
  context: string
  constraints: string
  acceptanceCriteria: string
  testPlan: string
  priority: WorkOrderPriority
  plan: WorkOrderPlan
  status: StoredWorkOrderPlanStatus
  savedAt: string
  lastRunId?: string | null
}

export type WorkOrderPlanStack = {
  version: 1
  activePlanId: string | null
  masterPlan: StoredWorkOrderPlan | null
  subPlans: StoredWorkOrderPlan[]
}

export function createPlanId(kind: WorkOrderPlanKind, savedAt: string) {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2, 10)
  return `${kind}-${savedAt}-${random}`
}

export function emptyPlanStack(): WorkOrderPlanStack {
  return {
    version: 1,
    activePlanId: null,
    masterPlan: null,
    subPlans: [],
  }
}

export function legacyPlanToStack(plan: Omit<StoredWorkOrderPlan, "id" | "kind"> | StoredWorkOrderPlan): WorkOrderPlanStack {
  const savedAt = plan.savedAt || new Date().toISOString()
  const masterPlan: StoredWorkOrderPlan = {
    ...plan,
    id: "id" in plan && plan.id ? plan.id : createPlanId("master", savedAt),
    kind: "master",
    savedAt,
  }

  return {
    ...emptyPlanStack(),
    activePlanId: masterPlan.id,
    masterPlan,
  }
}

export function isStoredWorkOrderPlan(value: unknown): value is StoredWorkOrderPlan {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<StoredWorkOrderPlan>
  return (
    typeof candidate.id === "string" &&
    (candidate.kind === "master" || candidate.kind === "sub_plan") &&
    typeof candidate.goal === "string" &&
    typeof candidate.context === "string" &&
    typeof candidate.constraints === "string" &&
    typeof candidate.acceptanceCriteria === "string" &&
    typeof candidate.testPlan === "string" &&
    (candidate.priority === "urgent" || candidate.priority === "high" || candidate.priority === "normal") &&
    Boolean(candidate.plan) &&
    (candidate.status === "ready" || candidate.status === "approved" || candidate.status === "sent_back") &&
    typeof candidate.savedAt === "string"
  )
}

export function isWorkOrderPlanStack(value: unknown): value is WorkOrderPlanStack {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<WorkOrderPlanStack>
  return (
    candidate.version === 1 &&
    (candidate.activePlanId === null || typeof candidate.activePlanId === "string") &&
    (candidate.masterPlan === null || isStoredWorkOrderPlan(candidate.masterPlan)) &&
    Array.isArray(candidate.subPlans) &&
    candidate.subPlans.every(isStoredWorkOrderPlan)
  )
}

export function getActiveStoredPlan(stack?: WorkOrderPlanStack | null): StoredWorkOrderPlan | null {
  if (!stack?.activePlanId) return null
  if (stack.masterPlan?.id === stack.activePlanId) return stack.masterPlan
  return stack.subPlans.find((plan) => plan.id === stack.activePlanId) ?? null
}

export function upsertMasterPlan(
  stack: WorkOrderPlanStack | undefined | null,
  plan: Omit<StoredWorkOrderPlan, "id" | "kind"> | StoredWorkOrderPlan,
): WorkOrderPlanStack {
  const current = stack ?? emptyPlanStack()
  const savedAt = plan.savedAt || new Date().toISOString()
  const masterPlan: StoredWorkOrderPlan = {
    ...plan,
    id: current.masterPlan?.id ?? ("id" in plan && plan.id ? plan.id : createPlanId("master", savedAt)),
    kind: "master",
    savedAt,
  }

  return {
    ...current,
    activePlanId: masterPlan.id,
    masterPlan,
  }
}

export function addSubPlan(
  stack: WorkOrderPlanStack | undefined | null,
  plan: Omit<StoredWorkOrderPlan, "id" | "kind"> | StoredWorkOrderPlan,
): WorkOrderPlanStack {
  const current = stack ?? emptyPlanStack()
  const savedAt = plan.savedAt || new Date().toISOString()
  const subPlan: StoredWorkOrderPlan = {
    ...plan,
    id: "id" in plan && plan.id ? plan.id : createPlanId("sub_plan", savedAt),
    kind: "sub_plan",
    savedAt,
  }

  return {
    ...current,
    activePlanId: subPlan.id,
    subPlans: [subPlan, ...current.subPlans.filter((item) => item.id !== subPlan.id)].slice(0, 12),
  }
}

export function updateActivePlanStatus(
  stack: WorkOrderPlanStack,
  status: StoredWorkOrderPlanStatus,
  savedAt: string,
): WorkOrderPlanStack {
  const activePlan = getActiveStoredPlan(stack)
  if (!activePlan) return stack
  const updated = { ...activePlan, status, savedAt }

  if (updated.kind === "master") {
    return { ...stack, masterPlan: updated }
  }

  return {
    ...stack,
    subPlans: stack.subPlans.map((plan) => (plan.id === updated.id ? updated : plan)),
  }
}

export function updateActivePlanRunId(stack: WorkOrderPlanStack, lastRunId: string | null): WorkOrderPlanStack {
  const activePlan = getActiveStoredPlan(stack)
  if (!activePlan) return stack
  const updated = { ...activePlan, lastRunId }

  if (updated.kind === "master") {
    return { ...stack, masterPlan: updated }
  }

  return {
    ...stack,
    subPlans: stack.subPlans.map((plan) => (plan.id === updated.id ? updated : plan)),
  }
}

export function activateMasterPlan(stack: WorkOrderPlanStack): WorkOrderPlanStack {
  if (!stack.masterPlan) return stack
  return {
    ...stack,
    activePlanId: stack.masterPlan.id,
  }
}

export function clearActivePlan(stack: WorkOrderPlanStack): WorkOrderPlanStack {
  const activePlan = getActiveStoredPlan(stack)
  if (!activePlan) return stack
  if (activePlan.kind === "master") {
    return { ...stack, activePlanId: null }
  }

  const subPlans = stack.subPlans.filter((plan) => plan.id !== activePlan.id)
  return {
    ...stack,
    activePlanId: stack.masterPlan?.id ?? subPlans[0]?.id ?? null,
    subPlans,
  }
}
