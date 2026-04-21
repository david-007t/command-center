"use client"

import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

type IntakeState = {
  name: string
  type: string
  valueProp: string
  targetUser: string
  dataSource: string
  aiRole: string
  outputFormat: string
  mvpFeatures: string[]
  outOfScope: string[]
  stackMode: "default" | "custom"
  customStack: string
  launchTarget: string
  priority: string
  businessGoal: string
  existingProject: boolean
  repoFolder: string
  currentState: string
  phase: string
}

const initialState: IntakeState = {
  name: "",
  type: "SaaS",
  valueProp: "",
  targetUser: "",
  dataSource: "",
  aiRole: "",
  outputFormat: "",
  mvpFeatures: [""],
  outOfScope: [""],
  stackMode: "default",
  customStack: "",
  launchTarget: "",
  priority: "medium",
  businessGoal: "",
  existingProject: false,
  repoFolder: "",
  currentState: "",
  phase: "SPEC",
}

export function IntakeForm() {
  const [form, setForm] = useState<IntakeState>(initialState)
  const [preview, setPreview] = useState("")
  const [status, setStatus] = useState("")

  function updateField<K extends keyof IntakeState>(key: K, value: IntakeState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function updateList(key: "mvpFeatures" | "outOfScope", index: number, value: string) {
    setForm((current) => {
      const next = [...current[key]]
      next[index] = value
      return { ...current, [key]: next }
    })
  }

  function addListItem(key: "mvpFeatures" | "outOfScope") {
    setForm((current) => ({ ...current, [key]: [...current[key], ""] }))
  }

  const valuePropCount = form.valueProp.length

  const previewMarkdown = useMemo(() => {
    return [
      `# Intake — ${form.name || "Untitled"}`,
      "",
      "## Product identity",
      `- Name: ${form.name}`,
      `- Type: ${form.type}`,
      `- Value prop: ${form.valueProp}`,
      `- Target user: ${form.targetUser}`,
      "",
      "## Three-layer architecture",
      `- Data source: ${form.dataSource}`,
      `- AI role: ${form.aiRole}`,
      `- Output format: ${form.outputFormat}`,
      "",
      "## Scope",
      ...form.mvpFeatures.filter(Boolean).map((item) => `- MVP: ${item}`),
      ...form.outOfScope.filter(Boolean).map((item) => `- Out of scope: ${item}`),
      "",
      "## Stack",
      `- Mode: ${form.stackMode}`,
      `- Detail: ${form.stackMode === "default" ? "Next.js + Supabase + Vercel + Clerk" : form.customStack}`,
      "",
      "## Timeline",
      `- Launch target: ${form.launchTarget}`,
      `- Priority: ${form.priority}`,
      `- Business goal: ${form.businessGoal}`,
      "",
      "## Existing project",
      `- Existing project: ${form.existingProject ? "yes" : "no"}`,
      `- Repo folder: ${form.repoFolder}`,
      `- Current state: ${form.currentState}`,
      `- Phase: ${form.phase}`,
    ].join("\n")
  }, [form])

  async function submit() {
    setStatus("Submitting...")
    const response = await fetch("/api/intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    })
    const data = await response.json()
    setStatus(response.ok ? `Saved to ${data.filePath}` : data.error ?? "Submit failed")
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <Card className="space-y-8">
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-100">1. Product identity</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <Input placeholder="Product name" value={form.name} onChange={(e) => updateField("name", e.target.value)} />
            <Select value={form.type} onChange={(e) => updateField("type", e.target.value)}>
              <option>SaaS</option>
              <option>Marketplace</option>
              <option>Internal tool</option>
              <option>Data product</option>
            </Select>
          </div>
          <div className="space-y-2">
            <Textarea
              maxLength={120}
              placeholder="Value proposition"
              value={form.valueProp}
              onChange={(e) => updateField("valueProp", e.target.value)}
            />
            <p className="text-xs text-slate-500">{valuePropCount}/120</p>
          </div>
          <Input placeholder="Target user" value={form.targetUser} onChange={(e) => updateField("targetUser", e.target.value)} />
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-100">2. Three-layer architecture</h2>
          <Input placeholder="Data source" value={form.dataSource} onChange={(e) => updateField("dataSource", e.target.value)} />
          <Input placeholder="AI role" value={form.aiRole} onChange={(e) => updateField("aiRole", e.target.value)} />
          <Input placeholder="Output format" value={form.outputFormat} onChange={(e) => updateField("outputFormat", e.target.value)} />
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-100">3. Scope</h2>
          <div className="space-y-3">
            {form.mvpFeatures.map((feature, index) => (
              <Input
                key={`mvp-${index}`}
                placeholder={`MVP feature ${index + 1}`}
                value={feature}
                onChange={(e) => updateList("mvpFeatures", index, e.target.value)}
              />
            ))}
            <Button
              variant="outline"
              onClick={() => addListItem("mvpFeatures")}
              disabled={form.mvpFeatures.length >= 5}
            >
              Add MVP feature
            </Button>
          </div>
          <div className="space-y-3">
            {form.outOfScope.map((item, index) => (
              <Input
                key={`scope-${index}`}
                placeholder={`Out of scope ${index + 1}`}
                value={item}
                onChange={(e) => updateList("outOfScope", index, e.target.value)}
              />
            ))}
            <Button variant="outline" onClick={() => addListItem("outOfScope")}>
              Add out-of-scope item
            </Button>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-100">4. Stack</h2>
          <div className="flex gap-3">
            <Button variant={form.stackMode === "default" ? "default" : "outline"} onClick={() => updateField("stackMode", "default")}>
              Default stack
            </Button>
            <Button variant={form.stackMode === "custom" ? "default" : "outline"} onClick={() => updateField("stackMode", "custom")}>
              Custom stack
            </Button>
          </div>
          {form.stackMode === "custom" ? (
            <Textarea placeholder="Describe custom stack" value={form.customStack} onChange={(e) => updateField("customStack", e.target.value)} />
          ) : null}
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-100">5. Timeline</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <Input type="date" value={form.launchTarget} onChange={(e) => updateField("launchTarget", e.target.value)} />
            <Select value={form.priority} onChange={(e) => updateField("priority", e.target.value)}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </Select>
            <Input placeholder="Business goal" value={form.businessGoal} onChange={(e) => updateField("businessGoal", e.target.value)} />
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-100">6. Existing project</h2>
          <div className="flex gap-3">
            <Button variant={form.existingProject ? "default" : "outline"} onClick={() => updateField("existingProject", true)}>
              Yes
            </Button>
            <Button variant={!form.existingProject ? "default" : "outline"} onClick={() => updateField("existingProject", false)}>
              No
            </Button>
          </div>
          {form.existingProject ? (
            <div className="space-y-3">
              <Input placeholder="Repo folder name" value={form.repoFolder} onChange={(e) => updateField("repoFolder", e.target.value)} />
              <Textarea placeholder="Current state" value={form.currentState} onChange={(e) => updateField("currentState", e.target.value)} />
              <Select value={form.phase} onChange={(e) => updateField("phase", e.target.value)}>
                <option>SPEC</option>
                <option>BUILD</option>
                <option>QA</option>
                <option>SHIP</option>
                <option>PARKED</option>
              </Select>
            </div>
          ) : null}
        </section>

        <div className="flex flex-wrap gap-3">
          <Button onClick={() => setPreview(previewMarkdown)}>Generate preview</Button>
          <Button variant="outline" onClick={() => void submit()}>
            Submit intake
          </Button>
          <p className="self-center text-sm text-slate-400">{status}</p>
        </div>
      </Card>

      <Card className="h-fit">
        <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Preview</p>
        <pre className="mt-4 whitespace-pre-wrap font-mono text-sm leading-7 text-slate-200">
          {preview || "Click “Generate preview” to see the intake markdown."}
        </pre>
      </Card>
    </div>
  )
}
