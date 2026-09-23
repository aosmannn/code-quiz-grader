import * as React from "react"
import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2.5 text-base text-[var(--ink)] transition-colors outline-none placeholder:text-[var(--ink-3)] focus-visible:border-[var(--brand)] focus-visible:ring-2 focus-visible:ring-[rgba(47,91,255,0.15)] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
