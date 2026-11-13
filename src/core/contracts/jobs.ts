import type { CallUsage } from "./chat.ts";
import type { PluginBackgroundResult } from "../plugin-workers.ts";
import type { OwllyMessage, OwllyMarkerMessage } from "../native-messages.ts";
import { newHandoffMessage } from "../native-messages.ts";


export type BuiltinJobKind = "research" | "demo" | "visual" | "pdf";
export type JobKind = BuiltinJobKind | "plugin";
export function isBuiltinJobKind(kind: JobKind): kind is BuiltinJobKind {
	return kind !== "plugin";
}
export interface PluginJobMetadata {
	pluginId: string;
	toolName: string;
	workerId: string;
	requestId: string;
	taskId?: string;
	input?: unknown;
	label?: string;
}
export type JobResult = ResearchResult | DemoResult | VisualResult | PdfResult | PluginBackgroundResult;
export type JobStatus = "running" | "done" | "error";

export interface JobRecord {
	id: string;
	kind: JobKind;
	chatId: string;
	toolCallId: string;
	input?: unknown;
	delivery?: { kind: "result" | "abort" | "failure"; status: "pending" | "delivered" };
	status: JobStatus;
	activity: string;
	createdAt: string;
	updatedAt: string;
	result?: unknown;
	error?: string;
	usage?: JobUsage;
	plugin?: PluginJobMetadata;
}

export interface JobUsage {
	model: string;
	inputTokens: number | undefined;
	outputTokens: number | undefined;
	cacheReadTokens: number | undefined;
	cacheWriteTokens: number | undefined;
	reasoningTokens: number | undefined;
	cacheWrite1hTokens?: number;
	calls?: CallUsage[];
	steps: number;
	lastStep?: CallUsage;
}

export interface UsageStepLike {
	inputTokens?: number | undefined;
	inputTokenDetails?: { cacheReadTokens?: number; cacheWriteTokens?: number; cacheWrite1hTokens?: number } | undefined;
	outputTokens?: number | undefined;
	outputTokenDetails?: { reasoningTokens?: number } | undefined;
}

export function piUsageToStep(usage: {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cacheWrite1h?: number;
	reasoning?: number;
}): UsageStepLike {
	return {
		inputTokens: usage.input,
		outputTokens: usage.output,
		inputTokenDetails: { cacheReadTokens: usage.cacheRead, cacheWriteTokens: usage.cacheWrite, cacheWrite1hTokens: usage.cacheWrite1h ?? 0 },
		outputTokenDetails: usage.reasoning !== undefined ? { reasoningTokens: usage.reasoning } : undefined,
	};
}

export function accumulateJobUsage(
	total: JobUsage | undefined,
	model: string,
	step: UsageStepLike,
): JobUsage {
	const add = (a: number | undefined, b: number | undefined): number | undefined =>
		a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);
	const call: CallUsage = {
		inputTokens: step.inputTokens,
		outputTokens: step.outputTokens,
		cacheReadTokens: step.inputTokenDetails?.cacheReadTokens,
		cacheWriteTokens: step.inputTokenDetails?.cacheWriteTokens,
		cacheWrite1hTokens: step.inputTokenDetails?.cacheWrite1hTokens,
		reasoningTokens: step.outputTokenDetails?.reasoningTokens,
	};
	return {
		model,
		inputTokens: add(total?.inputTokens, step.inputTokens),
		outputTokens: add(total?.outputTokens, step.outputTokens),
		cacheReadTokens: add(total?.cacheReadTokens, step.inputTokenDetails?.cacheReadTokens),
		cacheWriteTokens: add(total?.cacheWriteTokens, step.inputTokenDetails?.cacheWriteTokens),
		reasoningTokens: add(total?.reasoningTokens, step.outputTokenDetails?.reasoningTokens),
		cacheWrite1hTokens: ((total?.cacheWriteTokens ?? 0) > 0 && total?.cacheWrite1hTokens === undefined) ||
			((call.cacheWriteTokens ?? 0) > 0 && call.cacheWrite1hTokens === undefined)
			? undefined : add(total?.cacheWrite1hTokens, call.cacheWrite1hTokens),
		steps: (total?.steps ?? 0) + 1,
		...(!total || total.calls ? { calls: [...(total?.calls ?? []), call] } : {}),
		lastStep: call,
	};
}


export interface ResearchToolInput {
	question: string;
	context?: string;
}

export interface ResearchResult {
	brief: string;
	sources: { title: string; url: string }[];
}

export function isWebSourceUrl(url: string): boolean {
	try {
		const { protocol } = new URL(url);
		return protocol === "http:" || protocol === "https:";
	} catch {
		return false;
	}
}

export interface DemoToolInput {
	title: string;
	brief: string;
}

export interface DemoResult {
	title: string;
	html: string;
	tested: true;
	notes?: string;
}

export interface VisualToolInput {
	brief: string;
	image?: string;
}

export interface VisualResult {
	svg: string;
	notes?: string;
	image?: { path: string; snapshotId: string };
}

export interface PdfToolInput {
	path: string;
	question: string;
}

export interface PdfResult {
	path: string;
	question: string;
	brief: string;
	pagesRead: number[];
	pagesConsulted: number[];
}


export interface SubagentResultMeta {
	jobId: string;
	kind: JobKind;
	toolCallId: string;
	aborted?: true;
	failure?: string;
}

export interface SubagentArtifactData {
	kind: JobKind;
	result: JobResult;
	ui?: { inverted?: boolean };
}

export interface SteerDetails extends SubagentResultMeta {
	result: JobResult;
	ui?: { inverted?: boolean };
}

export function setSteerUiInverted(
	messages: readonly OwllyMessage[],
	messageId: string,
	inverted: boolean,
): OwllyMessage[] {
	return messages.map((m) => {
		if (m.id !== messageId) return m;
		const d = (m as OwllyMarkerMessage).details as Partial<SteerDetails> | undefined;
		if (!d || (d.kind !== "demo" && d.kind !== "visual")) return m;
		return { ...m, details: { ...d, ui: { ...d.ui, inverted } } } as OwllyMessage;
	});
}

export type SteerMessage = OwllyMarkerMessage;

export function isSubagentFailure(
	kind: JobKind,
	result: JobResult,
): boolean {
	if (kind === "plugin") return (result as PluginBackgroundResult).outcome.status !== "succeeded";
	if (kind === "research") {
		const r = result as ResearchResult;
		return r.sources.length === 0 && /^Research failed:/i.test(r.brief);
	}
	if (kind === "demo") {
		const r = result as DemoResult;
		return typeof r.html !== "string" || r.html.length === 0;
	}
	if (kind === "pdf") {
		const r = result as PdfResult;
		return /^PDF failed:/i.test(r.brief);
	}
	const r = result as VisualResult;
	return typeof r.svg !== "string" || r.svg.length === 0;
}

function steerText(kind: JobKind, result: JobResult): string {
	if (kind === "plugin") return (result as PluginBackgroundResult).text;
	if (isSubagentFailure(kind, result)) {
		if (kind === "research")
			return `${(result as ResearchResult).brief}\n\nContinue with what you can establish and flag the uncertainty to the learner.`;
		if (kind === "demo")
			return `The demo "${(result as DemoResult).title}" could not be built: ${
				(result as DemoResult).notes ?? "unknown reason"
			}. Fall back to explaining in prose; if the brief was the problem, re-call demo with a tighter one.`;
		if (kind === "pdf")
			return `${(result as PdfResult).brief}\n\nContinue with what you can establish from the session and flag the gap to the learner.`;
		return `The figure could not be made: ${(result as VisualResult).notes ?? "unknown reason"}. Fall back to prose or mermaid, or re-call visual with a tighter brief.`;
	}
	if (kind === "research")
		return `Research complete — the researcher's full brief follows. Weave it into the lesson and cite its sources when you use its findings:\n\n${(result as ResearchResult).brief}`;
	if (kind === "pdf")
		return `PDF reading complete — the reader's brief on "${(result as PdfResult).path}" follows, with page citations. Weave it into the lesson and cite pages when you use it:\n\n${(result as PdfResult).brief}`;
	if (kind === "demo")
		return `The demo "${(result as DemoResult).title}" is built, headlessly tested, and rendered in the lesson. Builder notes: ${
			(result as DemoResult).notes ?? "(none)"
		}.\nTeach with it — reference its controls by name and point the learner at what to try.`;
	if ((result as VisualResult).image)
		return `The annotated image is drawn, verified by inspection, and rendered in the lesson. Maker notes: ${
			(result as VisualResult).notes ?? "(none)"
		}.\nReference its marks as you teach.`;
	return `The figure is drawn, verified by inspection, and rendered in the lesson. Maker notes: ${
		(result as VisualResult).notes ?? "(none)"
	}.\nReference its elements as you teach.`;
}

export function buildSubagentSteer(
	job: Pick<JobRecord, "id" | "kind" | "toolCallId">,
	result: JobResult,
): SteerMessage {
	return {
		id: `steer_${job.id}`,
		role: "custom",
		customType: "subagent-steer",
		content: steerText(job.kind, result),
		display: true,
		details: {
			jobId: job.id,
			kind: job.kind,
			toolCallId: job.toolCallId,
			result,
		},
		timestamp: Date.now(),
	};
}

export function buildAbortSteer(
	job: Pick<JobRecord, "id" | "kind" | "toolCallId">,
): SteerMessage {
	const meta = { jobId: job.id, kind: job.kind, toolCallId: job.toolCallId, aborted: true } as const;
	return {
		id: `steer_${job.id}`,
		role: "custom",
		customType: "subagent-abort",
		content: abortText(job.kind),
		display: true,
		details: meta,
		timestamp: Date.now(),
	};
}

export function buildJobFailureSteer(
	job: Pick<JobRecord, "id" | "kind" | "toolCallId">,
	failure: string,
): SteerMessage {
	return {
		id: `steer_${job.id}`, role: "custom", customType: "subagent-abort", display: true,
		content: `Background job recovery or delivery failed: ${failure}. No worker outcome can be asserted. Acknowledge the failure and continue without waiting for this result.`,
		details: { jobId: job.id, kind: job.kind, toolCallId: job.toolCallId, failure },
		timestamp: Date.now(),
	};
}

function abortText(kind: JobKind): string {
	if (kind === "plugin") return "The learner aborted the background job before computation completed. Acknowledge it briefly and continue without waiting for a result.";
	if (kind === "research")
		return "Research aborted — the learner aborted the research job, so no brief is coming. Acknowledge it in one line and continue teaching without it (or offer to re-dispatch it).";
	if (kind === "demo")
		return "The demo job was aborted by the learner — no demo is coming. Acknowledge it in one line and teach the topic in prose instead (a re-dispatch is fine if the learner wants it).";
	if (kind === "pdf")
		return "The PDF reading job was aborted by the learner — no brief is coming. Acknowledge it in one line and continue without it (a re-dispatch is fine if the learner wants it).";
	return "The figure job was aborted by the learner — no figure is coming. Acknowledge it in one line and teach without it (a re-dispatch is fine if the learner wants it).";
}


export function buildProbeHandoffSteer(chatId: string): SteerMessage {
	return newHandoffMessage(chatId);
}

export function steerDelivered(messages: OwllyMessage[], steerId: string): boolean {
	return messages.some((m) => m.id === steerId);
}
