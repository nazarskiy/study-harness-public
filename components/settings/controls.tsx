"use client";

import { useLayoutEffect, useRef, useState, type ComponentPropsWithRef, type ReactNode } from "react";
import { ChevronDownIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

export function SettingsSection({
	title,
	hint,
	children,
	testid,
}: {
	title: string;
	hint?: string;
	children: React.ReactNode;
	testid?: string;
}) {
	return (
		<section data-testid={testid} className="px-6 py-6">
			<h2 className="text-xl font-extrabold text-foreground">{title}</h2>
			{hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
			<div className="mt-5 flex flex-col gap-3">{children}</div>
		</section>
	);
}

export function SettingsGroup({
	label,
	children,
	testid,
}: {
	label: string;
	children: React.ReactNode;
	testid?: string;
}) {
	return (
		<div data-testid={testid} className="mt-4 rounded-2xl border-2 border-border bg-card p-4 first:mt-0">
			<p className="mb-3 text-sm font-extrabold text-muted-foreground">{label}</p>
			<div className="flex flex-col gap-2">{children}</div>
		</div>
	);
}

export function SettingsRow({
	label,
	hint,
	children,
	testid,
	dimmed,
}: {
	label: string;
	hint?: ReactNode;
	children: React.ReactNode;
	testid?: string;
	dimmed?: boolean;
}) {
	return (
		<div data-testid={testid} className={cn("flex items-center justify-between gap-4 py-1.5", dimmed && "opacity-40")}>
			<span className="min-w-0">
				<span className="block text-base font-bold">{label}</span>
				{hint && <span className="block text-sm text-muted-foreground">{hint}</span>}
			</span>
			{children}
		</div>
	);
}

export function SettingsMenuTrigger({
	value, unavailable, disabled, className, ...props
}: Omit<ComponentPropsWithRef<"button">, "value" | "children"> & {
	value: string;
	unavailable?: boolean;
}) {
	return <button
		type="button"
		{...props}
		disabled={disabled}
		className={cn(
			"flex h-9 items-center gap-1.5 rounded-xl border-2 border-border bg-card px-3 text-sm font-bold text-foreground transition-colors",
			disabled || unavailable ? "cursor-not-allowed" : "hover:border-secondary hover:bg-muted",
			className,
		)}
	>
		<span className="min-w-0 flex-1 truncate">{value}</span>
		<ChevronDownIcon aria-hidden className="size-4 text-muted-foreground" />
	</button>;
}

export function Toggle({
	checked,
	disabled,
	onChange,
	label,
	discIcon,
	title,
}: {
	checked: boolean;
	disabled?: boolean;
	onChange: (next: boolean) => void;
	label: string;
	discIcon?: ReactNode;
	title?: string;
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			aria-label={label}
			{...(title ? { title } : {})}
			disabled={disabled}
			data-testid={`toggle-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
			onClick={() => onChange(!checked)}
			className={cn(
				"relative h-7 w-12 shrink-0 rounded-full transition-colors",
				checked ? "bg-primary shadow-[inset_0_-3px_0_var(--primary-shade)]" : "bg-muted shadow-[inset_0_-3px_0_var(--border)]",
				disabled && "cursor-not-allowed",
			)}
		>
			{discIcon ? (
				<span
					className={cn(
						"absolute left-0 top-1 flex size-5 items-center justify-center rounded-full bg-white shadow-sm transition-transform",
						checked ? "translate-x-6 text-primary-foreground" : "translate-x-1 text-muted-foreground",
					)}
				>
					{discIcon}
				</span>
			) : (
				<span
					className={cn(
						"absolute left-0 top-1 size-5 rounded-full bg-white shadow-sm transition-transform",
						checked ? "translate-x-6" : "translate-x-1",
					)}
				/>
			)}
		</button>
	);
}

export function ThinSelect({
	value,
	onChange,
	children,
	ariaLabel,
	testid,
	disabled,
}: {
	value: string;
	onChange: (next: string) => void;
	children: React.ReactNode;
	ariaLabel: string;
	testid?: string;
	disabled?: boolean;
}) {
	return (
		<select
			value={value}
			aria-label={ariaLabel}
			data-testid={testid}
			disabled={disabled}
			onChange={(e) => onChange(e.target.value)}
			className={cn(
				"h-9 rounded-xl border-2 border-border bg-card px-2.5 text-sm font-bold text-foreground outline-none focus:border-secondary",
				disabled && "cursor-not-allowed",
			)}
		>
			{children}
		</select>
	);
}

export function SettingsSlider({ label, min, max, step, value, display, onChange, disabled, showLabel = true }: {
	label: string;
	min?: number;
	max?: number;
	step?: number;
	value: number;
	display?: string;
	showLabel?: boolean;
	onChange: (value: number) => void;
	disabled?: boolean;
}) {
	return <label className={`flex flex-col gap-1${disabled ? " opacity-40" : ""}`}>
		<span className="flex items-center justify-between text-xs font-bold text-muted-foreground">
			{showLabel && label}<span className="tabular-nums">{display ?? value}</span>
		</span>
		<input type="range" aria-label={label} min={min} max={max} step={step} value={value} disabled={disabled}
			onChange={(e) => onChange(Number(e.target.value))} className="h-2 w-full accent-primary" />
	</label>;
}

export type SettingsCommitResult = boolean | Promise<boolean>;

export function CommitInput({
	value,
	placeholder,
	onCommit,
	ariaLabel,
	testid,
	type = "text",
	disabled,
	min,
	max,
	step,
}: {
	value: string;
	placeholder?: string;
	onCommit: (next: string) => SettingsCommitResult;
	ariaLabel: string;
	testid?: string;
	type?: "text" | "number";
	disabled?: boolean;
	min?: number;
	max?: number;
	step?: number;
}) {
	const [initialValue] = useState(value);
	const [, renderAcknowledgement] = useState(0);
	const input = useRef<HTMLInputElement>(null);
	const dirty = useRef(false);
	const revision = useRef(0);
	const latestCommit = useRef(0);
	const pending = useRef(new Set<number>());
	useLayoutEffect(() => {
		if (!dirty.current && input.current && input.current.value !== value) {
			input.current.value = value;
		}
	});

	const commit = async (element: HTMLInputElement) => {
		if (disabled || !dirty.current || element.validity?.badInput) return;
		const version = revision.current;
		if (pending.current.has(version)) return;
		const next = element.value.trim();
		if (next === value && pending.current.size === 0) {
			dirty.current = false;
			renderAcknowledgement((n) => n + 1);
			return;
		}
		const ticket = ++latestCommit.current;
		pending.current.add(version);
		try {
			const accepted = await onCommit(next);
			if (accepted && input.current === element && revision.current === version && latestCommit.current === ticket) {
				dirty.current = false;
				renderAcknowledgement((n) => n + 1);
			}
		} catch {
		} finally {
			pending.current.delete(version);
		}
	};
	return (
		<input
			ref={input}
			type={type}
			defaultValue={initialValue}
			placeholder={placeholder}
			aria-label={ariaLabel}
			data-testid={testid}
			disabled={disabled}
			min={min}
			max={max}
			step={step}
			onInput={() => {
				dirty.current = true;
				revision.current++;
			}}
			onBlur={(e) => { void commit(e.currentTarget); }}
			onKeyDown={(e) => {
				if (e.key === "Enter") e.currentTarget.blur();
				if (e.key === "Escape") {
					e.preventDefault();
					e.stopPropagation();
					e.currentTarget.blur();
				}
			}}
			className="h-9 w-40 rounded-xl border-2 border-border bg-card px-3 text-sm font-semibold text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-secondary"
		/>
	);
}