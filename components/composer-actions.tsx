"use client";

import type { ReactNode, Ref } from "react";
import { DumbbellIcon } from "@/components/ui/icons";

export function ComposerActions({ picker, setup }: { picker?: ReactNode; setup?: ReactNode }) {
	if (!picker && !setup) return null;
	return (
		<div
			data-testid="composer-actions"
			className={`pointer-events-auto mb-2 flex flex-wrap items-center gap-2 ${picker ? "justify-start" : "justify-center"}`}
		>
			{picker}
			{setup}
		</div>
	);
}

export function NodePickerControl({ count, onOpen, onClear, disabled, triggerRef }: {
	count: number;
	onOpen?: () => void;
	onClear?: () => void;
	disabled?: boolean;
	triggerRef?: Ref<HTMLButtonElement>;
}) {
	return (
		<div className="flex items-center gap-1.5">
			<button
				type="button"
				data-testid="practice-props-chip"
				ref={triggerRef}
				disabled={disabled}
				onClick={onOpen}
				className={
					"flex cursor-pointer items-center gap-1.5 rounded-xl border-2 px-3 py-1.5 text-xs font-extrabold transition-colors " +
					(count > 0
						? "border-secondary bg-secondary-soft text-secondary hover:brightness-105"
						: "border-dashed border-border bg-card text-muted-foreground hover:border-secondary hover:text-secondary")
				}
			>
				<DumbbellIcon aria-hidden="true" className="size-3.5" />
				{count > 0 ? `${count} ${count === 1 ? "node" : "nodes"} selected` : "Pick nodes"}
			</button>
			{count > 0 && (
				<button
					type="button"
					data-testid="practice-props-clear"
					disabled={disabled}
					onClick={onClear}
					className="cursor-pointer rounded-xl px-2.5 py-1.5 text-xs font-extrabold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
				>
					Clear
				</button>
			)}
		</div>
	);
}
