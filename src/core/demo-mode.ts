import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { QUESTION_TOOLS } from "./pending.ts";
import { readPluginQuestionMessageAnnotation } from "./plugin-questions.ts";
import { parseQuestionInput } from "./tool-parts.ts";

export const DEMO_QUESTION_LIMIT = 4;

export function demoModeEnabled(env: Record<string, string | undefined>): boolean {
	return env.OWLLY_DEMO_MODE === "1";
}

export function countDemoQuestions(messages: readonly AgentMessage[]): number {
	const native: { failed: boolean }[] = [];
	const pending = new Map<string, { failed: boolean }>();
	const custom = new Set<string>();
	const seen = new Set<string>();
	for (const [index, message] of messages.entries()) {
		if (message.role === "toolResult") {
			const call = pending.get(`${message.toolName}:${message.toolCallId}`);
			if (call && (message.isError || (message.details as { ok?: unknown } | null)?.ok === false)) call.failed = true;
			continue;
		}
		if (message.role !== "assistant") continue;
		for (const [contentIndex, call] of message.content.entries()) {
			if (call.type !== "toolCall") continue;
			const annotation = readPluginQuestionMessageAnnotation(message, contentIndex);
			if (annotation.status === "posed") { custom.add(annotation.snapshot.questionId); continue; }
			if (annotation.status === "unreadable") {
				const raw = (message as { owllyQuestions?: Record<string, unknown> }).owllyQuestions?.[String(contentIndex)];
				if (raw && typeof raw === "object" && typeof (raw as { questionId?: unknown }).questionId === "string") custom.add((raw as { questionId: string }).questionId);
				continue;
			}
			if (annotation.status !== "absent" || ["error", "aborted", "pending", "length"].includes(message.stopReason)) continue;
			if (!(QUESTION_TOOLS as readonly string[]).includes(call.name) || call.argumentsError || !parseQuestionInput(call.name, call.arguments)) continue;
			const occurrence = `${(message as { id?: string }).id ?? index}:${contentIndex}`;
			if (seen.has(occurrence)) continue;
			seen.add(occurrence);
			const candidate = { failed: false };
			native.push(candidate);
			pending.set(`${call.name}:${call.id}`, candidate);
		}
	}
	return native.filter(call => !call.failed).length + custom.size;
}

export function demoModeInstructions(asked: number): string {
	const remaining = Math.max(0, DEMO_QUESTION_LIMIT - asked);
	return `## Demo mode\n\nThe probing phase has a hard limit of ${DEMO_QUESTION_LIMIT} learner questions, including goal clarification. ${asked} questions have already been posed; ${remaining} remain. This limit overrides the requirement to bracket every strand. Leave unmeasured understanding explicitly unknown. Ask at most one question per turn.\n\nYour role remains probing only: do not teach or wrap up the lesson yourself. Whenever probing is complete, even before the limit, call probe_done with the evidence available and end your turn after its acknowledgment. The teacher must then create the learning graph with plan_init and present it before teaching, following the normal planning flow. Teaching questions are unlimited; this cap applies only to probing.\n\n` +
		(remaining > 0
			? "Use the remaining probing questions carefully. After the fourth answer, call probe_done without another probing question. Do not evade the limit with questions in prose."
			: "The probing question limit has been reached. Do not ask another probing question, including in prose. Call probe_done now using only the evidence available, without inventing an assessment, then end your turn so the teacher can create the learning graph.");
}
