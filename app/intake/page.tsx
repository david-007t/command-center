import { IntakeForm } from "@/components/intake-form"

export default function IntakePage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.4em] text-sky-300">Intake</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">New idea</h1>
      </div>
      <IntakeForm />
    </div>
  )
}
