import * as React from "react"
import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-lg border border-[var(--line-2)] bg-[#101820] px-2.5 py-2 text-base text-[var(--ink)] transition-colors outline-none placeholder:text-[var(--ink-3)] focus-visible:border-[var(--signal)] focus-visible:ring-3 focus-visible:ring-[color-mix(in_srgb,var(--signal)_30%,transparent)] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
