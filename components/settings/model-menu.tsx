"use client";

import { useEffect, useRef, useState } from "react";
import type { ModelCatalogEntry } from "@/src/core";
import { CLAUDE_CODE_PROVIDER, CUSTOM_PROVIDER, fuzzyScore, subscriptionLabel } from "@/src/core";
import { formatTokens } from "@/components/usage-format";
import { SearchMenuList } from "./search-menu-list";

function priceLabel(cost: ModelCatalogEntry["cost"]): string {
	if (!cost) return "Unpriced";
	const fmt = (n: number) => `$${n < 1 ? n.toFixed(2).replace(/0$/, "") : n.toFixed(2)}`;
	return `${fmt(cost.input)}/${fmt(cost.output)}`;
}

export function ModelMenuList({
	models,
	effectiveId,
	effectiveProvider,
	onPick,
	footer,
	vision,
	disabled = false,
}: {
	models: ModelCatalogEntry[] | undefined;
	effectiveId: string | undefined;
	effectiveProvider?: string;
	onPick: (entry: ModelCatalogEntry) => void;
	footer?: string;
	vision?: boolean;
	disabled?: boolean;
}) {
	const visionItems = vision
		? models?.filter((m) => m.input.includes("image") || m.provider === CUSTOM_PROVIDER.id)
		: models;
	return (
		<>
			<SearchMenuList
				items={visionItems}
				disabled={disabled}
				itemKey={(m) => `${m.provider}/${m.id}`}
				searchTerms={(m) => [m.provider, m.id, m.name]}
				compare={(a, b) => a.name.localeCompare(b.name)}
				groupBy={(m) => subscriptionLabel(`${m.provider}:${m.id}`) ?? m.provider}
				ariaLabel="Search models and providers"
				prioritize={vision ? (m) => m.input.includes("image") : undefined}
				isSelected={(m) => m.id === effectiveId && m.provider === (effectiveProvider ?? m.provider)}
				onPick={onPick}
				searchTestid="model-search"
				listTestid="model-list"
				optionTestid={(m) => `model-option-${m.id.replace(/[^a-z0-9-]/gi, "_")}`}
				placeholder="Search models…"
				loading="Loading models…"
				empty="No models match."
				renderItem={(m) => <>
					<span className="flex items-center justify-between gap-2">
						<span className="truncate text-card-foreground">{m.name}</span>
						<span className="shrink-0 tabular-nums text-muted-foreground" title={m.provider === CLAUDE_CODE_PROVIDER ? "Billing is determined by your Claude Code configuration; Owlly does not estimate it." : subscriptionLabel(`${m.provider}:${m.id}`) ? "Subscription connection" : m.cost ? "USD per 1M tokens in/out" : "Price unavailable"}>
							{m.provider === CLAUDE_CODE_PROVIDER ? "CLI billing" : subscriptionLabel(`${m.provider}:${m.id}`) ?? priceLabel(m.cost)}
						</span>
					</span>
					<span className="flex items-center justify-between gap-2 text-muted-foreground">
						<span className="truncate">{subscriptionLabel(`${m.provider}:${m.id}`) ? `${subscriptionLabel(`${m.provider}:${m.id}`)} (subscription)` : m.provider} · {m.id}</span>
						<span className="shrink-0 tabular-nums">{m.contextWindow === null ? "—" : formatTokens(m.contextWindow)}</span>
					</span>
				</>}
			/>
			{footer && (
				<div className="mt-1 border-t px-2 pt-1.5 text-xs text-muted-foreground">{footer}</div>
			)}
		</>
	);
}

export function ThinkingMenuList({
	levels,
	effectiveLevel,
	onPick,
	empty,
	footer,
}: {
	levels: string[];
	effectiveLevel: string | undefined;
	onPick: (level: string) => void;
	empty?: string;
	footer?: string;
}) {
	return (
		<>
			{levels.length === 0 ? (
				<div className="px-2 py-3 text-center text-muted-foreground">{empty ?? "No thinking levels."}</div>
			) : (
				levels.map((level) => (
					<button
						key={level}
						type="button"
						data-testid={`thinking-option-${level}`}
						onClick={() => onPick(level)}
						className={`flex items-center justify-between rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted ${
							level === effectiveLevel ? "bg-muted/60 text-card-foreground" : "text-card-foreground"
						}`}
					>
						<span>{level}</span>
						{level === effectiveLevel && <span aria-hidden>✓</span>}
					</button>
				))
			)}
			{footer && (
				<div className="mt-1 border-t px-2 pt-1.5 text-xs text-muted-foreground">{footer}</div>
			)}
		</>
	);
}

export function ProviderMenuList({
	providers,
	onPick,
}: {
	providers: { id: string; envVar: string; label: string }[];
	onPick: (provider: { id: string; envVar: string; label: string }) => void;
}) {
	const [query, setQuery] = useState("");
	const [menuIdx, setMenuIdx] = useState<number | null>(null);
	const searchRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLUListElement>(null);

	useEffect(() => {
		searchRef.current?.focus();
	}, []);

	useEffect(() => {
		if (menuIdx === null) return;
		listRef.current?.querySelector(`[data-idx="${menuIdx}"]`)?.scrollIntoView({ block: "nearest" });
	}, [menuIdx]);

	const results = providers
		.map((p) => ({ p, s: fuzzyScore(query, p.id, p.envVar, p.label) }))
		.filter((r) => r.s !== null)
		.sort((a, b) => b.s! - a.s! || a.p.id.localeCompare(b.p.id))
		.map((r) => r.p);

	return (
		<>
			<input
				ref={searchRef}
				data-testid="provider-search"
				value={query}
				onChange={(e) => {
					setQuery(e.target.value);
					setMenuIdx(null);
				}}
				onKeyDown={(e) => {
					if (e.key === "ArrowDown" || e.key === "ArrowUp") {
						e.preventDefault();
						e.stopPropagation();
						if (results.length === 0) return;
						setMenuIdx((i) =>
							e.key === "ArrowDown"
								? Math.min((i ?? -1) + 1, results.length - 1)
								: Math.max((i ?? results.length) - 1, 0),
						);
					} else if (e.key === "Enter") {
						const chosen = results[menuIdx ?? 0];
						if (chosen) {
							e.preventDefault();
							e.stopPropagation();
							onPick(chosen);
						}
					}
				}}
				placeholder="Search providers…"
				className="ow-input mb-1.5 w-full rounded-lg border-2 bg-background px-2 py-1.5 text-foreground outline-none focus:ring-1 focus:ring-ring"
			/>
			{results.length === 0 && (
				<div className="px-2 py-3 text-center text-muted-foreground">No providers match.</div>
			)}
			<ul ref={listRef} data-testid="provider-list" className="flex max-h-72 flex-col overflow-y-auto px-1">
				{results.map((p, i) => (
					<li key={p.id}>
						<button
							type="button"
							data-testid={`provider-option-${p.id.replace(/[^a-z0-9-]/gi, "_")}`}
							data-idx={i}
							onClick={() => onPick(p)}
							className={`flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left outline-none transition-colors hover:bg-muted ${
								i === menuIdx ? "bg-accent ring-1 ring-inset ring-border" : ""
							}`}
						>
							<span className="truncate text-card-foreground">{p.label}</span>
							<span className="shrink-0 font-mono text-xs text-muted-foreground">{p.envVar}</span>
						</button>
					</li>
				))}
			</ul>
		</>
	);
}
