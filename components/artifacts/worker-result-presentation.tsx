"use client";

import type { ReactNode } from "react";
import { CheckIcon, ChevronRight } from "@/components/ui/icons";
import { Hint } from "@/components/ui/hint";

export function WorkerResultDetails({ heading, children, icon = <CheckIcon className="size-3.5" />, testId, headerTestId, headerTooltip, disclosure = "labels", viewLabel = "view brief", hideLabel = "hide brief" }: {
	heading: ReactNode;
	children: ReactNode;
	icon?: ReactNode;
	testId?: string;
	headerTestId?: string;
	headerTooltip?: string;
	disclosure?: "labels" | "chevron";
	viewLabel?: string;
	hideLabel?: string;
}) {
	const summary = (
		<summary data-testid={headerTestId} className="relative flex cursor-pointer select-none list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
			{icon}
			{heading}
			{disclosure === "chevron" ? (
				<ChevronRight aria-hidden="true" className="size-3 shrink-0 opacity-50 transition-transform group-open:rotate-90" />
			) : <>
				<span className="ml-1 text-xs text-muted-foreground/70 group-open:hidden">{viewLabel}</span>
				<span className="ml-1 hidden text-xs text-muted-foreground/70 group-open:inline">{hideLabel}</span>
			</>}
		</summary>
	);
	return (
		<details data-testid={testId} className="group w-full text-xs text-muted-foreground">
			{headerTooltip ? <Hint label={headerTooltip}>{summary}</Hint> : summary}
			<div className="mt-2">{children}</div>
		</details>
	);
}
