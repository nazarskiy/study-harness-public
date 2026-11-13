"use client";

import { ChevronDownIcon } from "@/components/ui/icons";

import type { ComponentProps } from "react";

export function ModelPickerPill({ children, ...props }: ComponentProps<"button">) {
	return <button type="button" {...props}
		className="flex h-8 items-center gap-1 rounded-xl border-2 bg-card pl-3 pr-2 text-xs font-extrabold shadow-[0_3px_0_var(--border)] transition-[transform,box-shadow,background-color] duration-100 hover:bg-muted active:translate-y-[3px] active:shadow-none disabled:opacity-50">
		<span className="text-card-foreground">{children}</span>
		<ChevronDownIcon aria-hidden className="size-3.5 text-muted-foreground" />
	</button>;
}
