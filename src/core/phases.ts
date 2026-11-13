
import { posedPluginQuestionOfPart } from "./tool-parts.ts";
import { readPluginQuestionMessageAnnotation } from "./plugin-questions.ts";

export type Phase3 = "probe" | "plan" | "teach";

export interface PhaseMessage {
	parts: ReadonlyArray<{ type: string; state?: string; input?: unknown; output?: unknown; pluginQuestion?: unknown }>;
}

function taggedNodeId(input: unknown): boolean {
	return (
		typeof input === "object" &&
		input !== null &&
		typeof (input as { nodeId?: unknown }).nodeId === "string" &&
		(input as { nodeId: string }).nodeId.length > 0
	);
}

function isTeachQuestionPart(part: PhaseMessage["parts"][number]): boolean {
	if (part.pluginQuestion !== undefined) {
		const snapshot = posedPluginQuestionOfPart(part);
		return snapshot?.variant === "teach" && taggedNodeId(snapshot.input);
	}
	return (part.type === "tool-quiz" || part.type === "tool-explain") && taggedNodeId(part.input);
}

export function phaseAt3(messages: readonly PhaseMessage[], upToIndex?: number): Phase3 {
	let phase: Phase3 = "probe";
	const last = Math.min(upToIndex ?? messages.length - 1, messages.length - 1);
	for (let i = 0; i <= last; i++) {
		phase = advance(phase, messages[i]?.parts);
	}
	return phase;
}

function advance(
	phase: Phase3,
	parts: PhaseMessage["parts"] | undefined,
): Phase3 {
	if (!parts) return phase;
	for (const part of parts) {
		if (
			phase === "probe" && part.type === "tool-probe_done" && part.state === "output-available" &&
			(part.output as { ok?: unknown } | null | undefined)?.ok !== false
		) {
			phase = "plan";
		}
		if (
			phase === "plan" && isTeachQuestionPart(part)
		) {
			phase = "teach";
		}
	}
	return phase;
}

export function teachStepIndex(
	parts: PhaseMessage["parts"],
): number {
	let stepStarts = 0;
	let latest = -1;
	for (let i = 0; i < parts.length; i++) {
		const part = parts[i]!;
		if (part.type === "step-start") {
			stepStarts++;
			latest = i;
			continue;
		}
		if (isTeachQuestionPart(part)) {
			return stepStarts <= 1 ? -1 : latest;
		}
	}
	return -1;
}

export function phaseTimeline(messages: readonly PhaseMessage[]): Phase3[] {
	const out: Phase3[] = [];
	let phase: Phase3 = "probe";
	for (let i = 0; i < messages.length; i++) {
		phase = advance(phase, messages[i]?.parts);
		out.push(phase);
	}
	return out;
}


import { probeDoneResultIds, type OwllyMessage } from "./native-messages.ts";

export function phaseAt3Lh(messages: readonly OwllyMessage[], upToIndex?: number): Phase3 {
	let phase: Phase3 = "probe";
	const last = Math.min(upToIndex ?? messages.length - 1, messages.length - 1);
	const concluded = probeDoneResultIds(messages.slice(0, last + 1));
	for (let i = 0; i <= last; i++) {
		const m = messages[i]!;
		const role = (m as { role?: string }).role;
		if (role === "toolResult") {
			if (phase === "probe" && concluded.has(m.id)) phase = "plan";
		} else if (role === "assistant") {
			const content = (m as { content?: ReadonlyArray<{ type?: string; name?: string; arguments?: unknown }> }).content ?? [];
			if (phase === "plan") {
				for (const [contentIndex, block] of content.entries()) {
					const annotation = readPluginQuestionMessageAnnotation(m, contentIndex);
					if (annotation.status !== "absent") {
						if (annotation.status === "posed" && annotation.snapshot.variant === "teach" && taggedNodeId(annotation.snapshot.input)) { phase = "teach"; break; }
						continue;
					}
					if (
						block.type === "toolCall" &&
						(block.name === "quiz" || block.name === "explain") &&
						taggedNodeId(block.arguments)
					) {
						phase = "teach";
						break;
					}
				}
			}
		}
	}
	return phase;
}
