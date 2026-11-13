import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-10 w-full min-w-0 rounded-xl border-2 border-input bg-card px-3.5 py-1 text-base font-semibold transition-colors outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-bold file:text-foreground placeholder:font-medium placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-secondary",
        "aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Input }
