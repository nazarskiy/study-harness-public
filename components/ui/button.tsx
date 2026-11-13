import { cva,type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/utils";
interface ButtonColorState { background?: string; text?: string; border?: string }
interface ButtonColors extends ButtonColorState { hover?: ButtonColorState; active?: ButtonColorState; focusVisible?: ButtonColorState & { ring?: string }; disabled?: ButtonColorState }

const PRESS = "active:translate-y-[3px] active:shadow-none disabled:shadow-none"

const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl text-sm font-extrabold whitespace-nowrap transition-[transform,box-shadow,background-color,color,border-color] duration-100 outline-none select-none focus-visible:ring-4 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: `bg-primary text-primary-foreground shadow-[0_4px_0_var(--primary-shade)] hover:brightness-105 ${PRESS}`,
        secondary: `bg-secondary text-secondary-foreground shadow-[0_4px_0_var(--secondary-shade)] hover:brightness-110 ${PRESS}`,
        destructive: `bg-destructive text-white shadow-[0_4px_0_var(--destructive-shade)] hover:brightness-105 ${PRESS}`,
        outline: `border-2 border-border bg-card text-foreground shadow-[0_3px_0_var(--border)] hover:bg-muted ${PRESS}`,
        ghost: "text-foreground hover:bg-accent",
        link: "text-secondary underline-offset-4 hover:underline",
        custom: "border-2 border-transparent bg-primary text-primary-foreground",
      },
      size: {
        default: "h-10 px-5 has-[>svg]:px-4 has-[>[data-slot=button-icon]]:px-4",
        xs: "h-7 gap-1 rounded-lg px-2.5 text-xs has-[>svg]:px-2 has-[>[data-slot=button-icon]]:px-2 [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-8 gap-1.5 rounded-lg px-3.5 text-xs has-[>svg]:px-3 has-[>[data-slot=button-icon]]:px-3",
        lg: "h-12 rounded-2xl px-7 text-base uppercase tracking-wide has-[>svg]:px-6 has-[>[data-slot=button-icon]]:px-6",
        icon: "size-10",
        "icon-xs": "size-7 rounded-lg [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-8 rounded-lg",
        "icon-lg": "size-12 rounded-2xl",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function customButtonColors(colors?: ButtonColors) {
  const style: React.CSSProperties & Record<`--button-custom-${string}`, string> = {}
  const classes: string[] = []
  const add = (value: string | undefined, variable: `--button-custom-${string}`, className: string) => {
    if (value === undefined) return
    style[variable] = value
    classes.push(className)
  }
  add(colors?.background, "--button-custom-background", "bg-[color:var(--button-custom-background)]")
  add(colors?.text, "--button-custom-text", "text-[color:var(--button-custom-text)]")
  add(colors?.border, "--button-custom-border", "border-[color:var(--button-custom-border)]")
  add(colors?.hover?.background, "--button-custom-hover-background", "hover:bg-[color:var(--button-custom-hover-background)]")
  add(colors?.hover?.text, "--button-custom-hover-text", "hover:text-[color:var(--button-custom-hover-text)]")
  add(colors?.hover?.border, "--button-custom-hover-border", "hover:border-[color:var(--button-custom-hover-border)]")
  add(colors?.active?.background, "--button-custom-active-background", "active:bg-[color:var(--button-custom-active-background)]")
  add(colors?.active?.text, "--button-custom-active-text", "active:text-[color:var(--button-custom-active-text)]")
  add(colors?.active?.border, "--button-custom-active-border", "active:border-[color:var(--button-custom-active-border)]")
  add(colors?.focusVisible?.background, "--button-custom-focus-visible-background", "focus-visible:bg-[color:var(--button-custom-focus-visible-background)]")
  add(colors?.focusVisible?.text, "--button-custom-focus-visible-text", "focus-visible:text-[color:var(--button-custom-focus-visible-text)]")
  add(colors?.focusVisible?.border, "--button-custom-focus-visible-border", "focus-visible:border-[color:var(--button-custom-focus-visible-border)]")
  add(colors?.focusVisible?.ring, "--button-custom-focus-visible-ring", "focus-visible:ring-[color:var(--button-custom-focus-visible-ring)]")
  add(colors?.disabled?.background, "--button-custom-disabled-background", "disabled:bg-[color:var(--button-custom-disabled-background)]")
  add(colors?.disabled?.text, "--button-custom-disabled-text", "disabled:text-[color:var(--button-custom-disabled-text)]")
  add(colors?.disabled?.border, "--button-custom-disabled-border", "disabled:border-[color:var(--button-custom-disabled-border)]")
  return { style, classes }
}

function Button({
  className,
  colors,
  style,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    colors?: ButtonColors
  }) {
  const Comp = asChild ? Slot.Root : "button"
  const customColors = variant === "custom" ? customButtonColors(colors) : undefined

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size }), customColors?.classes, className)}
      style={customColors ? { ...customColors.style, ...style } : style}
      {...props}
    />
  )
}

export { Button,buttonVariants };
