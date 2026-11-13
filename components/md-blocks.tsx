"use client";


import { cloneElement, createContext, isValidElement, useContext, useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { CheckIcon, CopyIcon, MaximizeIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import {
	CodeBlock,
	extractTableDataFromElement,
	tableDataToMarkdown,
	useIsCodeFenceIncomplete,
} from "streamdown";
import type { ExtraProps } from "streamdown";
import { MERMAID_FONT_SIZE, renderMermaid } from "@/components/mermaid-render";
import { useAppearance } from "@/components/settings/appearance";
import { MermaidError } from "@/components/mermaid-error";
import { blurAfterPointerClick } from "@/components/focus-hygiene";
import { chartSize, useSessionMermaid } from "@/components/session-overlay";
import { Hint } from "@/components/ui/hint";
import { BUILTIN_MERMAID_LANGUAGE, PluginCodeBlock } from "@/components/plugin-renderers";

export const MarkdownDisplayOnlyContext = createContext(false);


async function copyText(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
	}
	try {
		const ta = document.createElement("textarea");
		ta.value = text;
		ta.setAttribute("readonly", "");
		ta.style.position = "fixed";
		ta.style.opacity = "0";
		document.body.appendChild(ta);
		ta.select();
		const ok = document.execCommand("copy");
		ta.remove();
		return ok;
	} catch {
		return false;
	}
}

export function CopyCorner({
	getText,
	label,
	className,
}: {
	getText: () => string;
	label: string;
	className?: string;
}) {
	const [copied, setCopied] = useState(false);
	const timerRef = useRef<number | undefined>(undefined);
	useEffect(() => () => window.clearTimeout(timerRef.current), []);
	return (
		<span className={cn("relative inline-flex", className)}>
			<button
				type="button"
				aria-label={label}
				data-testid="md-copy"
				className="flex size-6 items-center justify-center rounded-md text-muted-foreground/70 opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/md:opacity-100"
				onClick={(e) => {
					blurAfterPointerClick(e);
					void copyText(getText()).then((ok) => {
						if (!ok) return;
						setCopied(true);
						window.clearTimeout(timerRef.current);
						timerRef.current = window.setTimeout(() => setCopied(false), 1500);
					});
				}}
			>
				{copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
			</button>
		</span>
	);
}


export function codeSource(children: ReactNode): string {
	if (typeof children === "string") return children;
	if (typeof children === "number") return String(children);
	if (isValidElement(children)) {
		const inner = (children.props as { children?: ReactNode }).children;
		if (typeof inner === "string") return inner;
	}
	return "";
}

function MermaidInline({ chart }: { chart: string }) {
	const displayOnly = useContext(MarkdownDisplayOnlyContext);
	const [svg, setSvg] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [attempt, setAttempt] = useState(0);
	const overlay = useSessionMermaid();
	const incomplete = useIsCodeFenceIncomplete();
	const { resolvedMode } = useAppearance();
	const holderRef = useRef<HTMLDivElement>(null);
	const [capW, setCapW] = useState<number | null>(null);
	useEffect(() => {
		if (!svg || !holderRef.current) return;
		const fs = Number.parseFloat(getComputedStyle(holderRef.current).fontSize);
		if (!Number.isFinite(fs) || fs <= 0) return;
		const { w } = chartSize(svg);
		setCapW((w * fs) / MERMAID_FONT_SIZE);
	}, [svg]);

	useEffect(() => {
		if (incomplete) return;
		let cancelled = false;
		setSvg(null);
		setError(null);
		renderMermaid(chart, resolvedMode)
			.then((s) => {
				if (!cancelled) setSvg(s);
			})
			.catch((e) => {
				if (!cancelled) setError(e instanceof Error ? e.message : String(e));
			});
		return () => {
			cancelled = true;
		};
	}, [chart, attempt, incomplete, resolvedMode]);

	if (incomplete || (svg === null && error === null)) {
		return (
			<div data-testid="md-mermaid" className="my-4 flex justify-center p-4" aria-busy="true">
				<span className="inline-block size-4 animate-spin rounded-full border-2 border-current border-b-2 text-muted-foreground" />
			</div>
		);
	}
	if (error !== null) {
		return <MermaidError chart={chart} error={error} retry={() => setAttempt((a) => a + 1)} displayOnly={displayOnly} />;
	}
	return (
		<div data-testid="md-mermaid" data-streamdown="mermaid" className="group/md relative my-4">
			<div
				ref={holderRef}
				className="mx-auto flex w-full justify-center"
				style={capW === null ? undefined : { maxWidth: `${capW}px` }}
				dangerouslySetInnerHTML={{ __html: svg ?? "" }}
			/>
			{!displayOnly && <div className="absolute top-0 right-0 flex items-start gap-0.5">
				<CopyCorner getText={() => chart} label="Copy diagram source" />
				{overlay && (
					<Hint
					label="Open full-screen"
					side="bottom"
				>
<button
						type="button"
						aria-label="Expand diagram"
						data-testid="md-mermaid-expand"
												className="flex size-6 items-center justify-center rounded-md text-muted-foreground/70 opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover/md:opacity-100"
						onClick={(e) => {
							blurAfterPointerClick(e);
							overlay.openMermaid(chart);
						}}
					>
						<MaximizeIcon className="size-3.5" />
					</button>
				</Hint>
				)}
			</div>}
		</div>
	);
}

export function MarkdownCode(props: ComponentProps<"code"> & ExtraProps) {
	const displayOnly = useContext(MarkdownDisplayOnlyContext);
	const incomplete = useIsCodeFenceIncomplete();
	const { children, className, node, ...rest } = props;

	if (!("data-block" in props)) {
		return (
			<code className={cn("rounded-md px-1.5 py-0.5 font-mono text-sm text-(--ow-ink-code)", className)} data-streamdown="inline-code" {...rest}>
				{children}
			</code>
		);
	}

	const language = /language-([^\s]+)/.exec(className ?? "")?.[1] ?? "";
	const meta = (node?.properties?.metastring as string | undefined) ?? "";
	const source = codeSource(children);

	if (language === BUILTIN_MERMAID_LANGUAGE) return <MermaidInline chart={source} />;

	const startMatch = /startLine=(\d+)/.exec(meta);
	const startLine = startMatch ? Number.parseInt(startMatch[1]!, 10) : undefined;
	const lineNumbers = !/\bnoLineNumbers\b/.test(meta);
	const fallback = (
		<div className="group/md relative" data-testid="md-code">
			{!displayOnly && <CopyCorner className="absolute top-1.5 right-2 z-10" getText={() => source} label="Copy code" />}
			<CodeBlock
				code={source}
				language={language}
				className={className}
				isIncomplete={incomplete}
				startLine={startLine !== undefined && startLine >= 1 ? startLine : undefined}
				lineNumbers={lineNumbers}
			/>
		</div>
	);
	return displayOnly ? fallback : <PluginCodeBlock language={language} source={source} meta={meta} incomplete={incomplete} fallback={fallback} />;
}


const ALERT_MARKER_RE = /^\[!(note|tip|important|warning|caution)\][ \t]*(?:\n|$)/i;

export interface ParsedAlert {
	kind: string;
	children: ReactNode;
}

const significant = (c: ReactNode) => c !== null && c !== undefined && c !== "" && !(typeof c === "string" && c.trim() === "");

function markdownTag(el: React.ReactElement): string | null {
	if (typeof el.type === "string") return el.type;
	const node = (el.props as { node?: { tagName?: string } }).node;
	return node?.tagName ?? null;
}

export function parseAlertMarker(children: ReactNode): ParsedAlert | null {
	const list = Array.isArray(children) ? children : [children];
	const para = list.find(significant);
	if (!isValidElement(para) || markdownTag(para) !== "p") return null;
	const inner = (para.props as { children?: ReactNode }).children;
	const innerList = Array.isArray(inner) ? inner : [inner];
	const lead = innerList.find(significant);
	if (typeof lead !== "string") return null;
	const match = ALERT_MARKER_RE.exec(lead);
	if (!match) return null;
	const kind = match[1]!.toLowerCase();
	const stripped = lead.slice(match[0].length);
	const leadIdxInner = innerList.indexOf(lead);
	const hasFollowing = innerList.some((c, i) => i > leadIdxInner && significant(c));
	let rebuiltPara: ReactNode = null;
	if (stripped.trim() !== "" || hasFollowing) {
		let rest = innerList.map((c) => (c === lead ? (stripped === "" ? null : stripped) : c));
		if (stripped === "") {
			while (rest.length && (rest[0] === null || (isValidElement(rest[0]) && markdownTag(rest[0]) === "br"))) rest = rest.slice(1);
		}
		rebuiltPara = cloneElement(para, {}, ...rest);
	}
	const leadIdx = list.indexOf(para);
	const restChildren = [...list.slice(0, leadIdx), ...(rebuiltPara ? [rebuiltPara] : []), ...list.slice(leadIdx + 1)];
	return { kind, children: restChildren };
}

export function MarkdownBlockquote(props: ComponentProps<"blockquote"> & ExtraProps) {
	const { children, node, ...rest } = props;
	const alert = parseAlertMarker(children);
	if (!alert) {
		return (
			<blockquote
				{...rest}
				className="my-4 border-l-4 border-muted-foreground/30 pl-4 text-muted-foreground italic"
				data-streamdown="blockquote"
			>
				{children}
			</blockquote>
		);
	}
	return (
		<div
			data-testid="md-callout"
			data-alert-kind={alert.kind}
			className="my-4 w-fit max-w-full border-2 border-line-strong px-4 py-3 [&> :first-child]:mt-0 [&> :last-child]:mb-0"
		>
			{alert.children}
		</div>
	);
}


export function MarkdownTable(props: ComponentProps<"table"> & ExtraProps) {
	const displayOnly = useContext(MarkdownDisplayOnlyContext);
	const { children, node, ...rest } = props;
	const ref = useRef<HTMLTableElement>(null);
	return (
		<div className="group/md relative my-4" data-testid="md-table">
			{!displayOnly && <CopyCorner
				className="absolute top-1 right-1 z-10"
				label="Copy table"
				getText={() => (ref.current ? tableDataToMarkdown(extractTableDataFromElement(ref.current)) : "")}
			/>}
			<div className="overflow-x-auto">
				<table
					ref={ref}
					className="w-full border-collapse"
					data-streamdown="table"
					{...rest}
				>
					{children}
				</table>
			</div>
		</div>
	);
}


export function MathDisplay(props: ComponentProps<"span"> & ExtraProps) {
	const displayOnly = useContext(MarkdownDisplayOnlyContext);
	const { children, className, node, ...rest } = props;
	const ref = useRef<HTMLSpanElement>(null);
	if (!className?.includes("katex-display")) {
		return (
			<span className={className} {...rest}>
				{children}
			</span>
		);
	}
	return (
		<span className="group/md relative block z-0" data-testid="md-math">
			{!displayOnly && <CopyCorner
				className="absolute top-0 right-0 z-10"
				label="Copy equation source"
				getText={() => ref.current?.querySelector("annotation")?.textContent ?? ""}
			/>}
			<span ref={ref} className={className} {...rest}>
				{children}
			</span>
		</span>
	);
}


export function MarkdownStrong(props: ComponentProps<"strong"> & ExtraProps) {
	const { children, className, node, ...rest } = props;
	return (
		<strong data-streamdown="strong" className={className} {...rest}>
			{children}
		</strong>
	);
}

export const mdComponents = {
	code: MarkdownCode,
	table: MarkdownTable,
	span: MathDisplay,
	strong: MarkdownStrong,
	blockquote: MarkdownBlockquote,
};
