import * as React from "react"
import { cn } from "@/lib/utils"

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "outline" | "ghost" | "destructive"
}

export function Button({
  className,
  variant = "default",
  ...props
}: ButtonProps) {
  const variants: Record<NonNullable<ButtonProps["variant"]>, string> = {
    default: "bg-sky-500 text-slate-950 hover:bg-sky-400",
    outline: "border border-slate-700 bg-transparent text-slate-100 hover:bg-slate-900",
    ghost: "bg-transparent text-slate-200 hover:bg-slate-900",
    destructive: "bg-rose-600 text-white hover:bg-rose-500",
  }

  return (
    <button
      className={cn(
        "inline-flex min-h-11 items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        className,
      )}
      {...props}
    />
  )
}
