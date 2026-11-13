
import type { AssistantMessage, ImageContent, ToolResultMessage } from "@earendil-works/pi-ai";
import type { OwllyMarkerMessage, OwllyMessage } from "./native-messages.ts";
import { modelSolutionForConclude, PRACTICE_CONCLUDE_TOOL, problemInputForConclude, SEND_TO_USER_TOOL, sendToUserText, pluginQuestionResultMatches } from "./native-messages.ts";
import { readPluginQuestionMessageAnnotation, readPluginQuestionCancellation, type PluginQuestionAnnotationRead } from "./plugin-questions.ts";
import { pluginProblemForCall, type PluginProblemSnapshot } from "./plugin-problems.ts";
import { activeCompactionOf, type CompactionDetails } from "./compaction.ts";
import { QUESTION_TOOLS } from "./pending.ts";
import type { SubagentArtifactData, SubagentResultMeta } from "./contracts/jobs.ts";
import type { PlanBlockData } from "./contracts/chat.ts";

export interface OwllyViewPart extends Record<string, unknown> {
	type: string;
	id?: string;
	text?: string;
	state?: string;
	toolCallId?: string;
	sourceMessageId?: string;
	sourceContentIndex?: number;
	pluginQuestion?: Exclude<PluginQuestionAnnotationRead, { status: "absent" }>;
	pluginProblem?: PluginProblemSnapshot;
	input?: unknown;
	output?: unknown;
	rawInput?: unknown;
	errorText?: string;
	result?: Pick<ToolResultMessage, "content" | "details" | "isError">;
	data?: unknown;
}

export interface OwllyViewMessage {
	id: string;
	role: "user" | "assistant";
	parts: OwllyViewPart[];
	metadata?: unknown;
}

export interface LiveExecution {
	isError: boolean;
	output?: unknown;
	errorText?: string;
	result?: Pick<ToolResultMessage, "content" | "details" | "isError">;
}

export interface LiveTurnState {
	executions: ReadonlyMap<string, LiveExecution>;
	inFlight: boolean;
	streamingIds: ReadonlySet<string>;
}

function textPart(text: string): OwllyViewPart {
	return { type: "text", text, state: "done" };
}

function applyResult(part: OwllyViewPart, result: ToolResultMessage): void {
	if (part.pluginQuestion) {
		if (result.isError) { part.state = "output-error"; return; }
		part.state = "output-available";
		part.output = result.details;
		return;
	}
	part.result = { content: result.content, details: result.details, isError: result.isError };
	if (result.isError) {
		part.state = "output-error";
		part.rawInput = part.input;
		const text = result.content.find((c) => c.type === "text");
		part.errorText = text && text.type === "text" ? text.text : "The tool call failed.";
	} else {
		part.state = "output-available";
		part.output = result.details;
	}
}

function lastSuccessfulPlanInit(parts: OwllyViewPart[]): number {
	let idx = -1;
	parts.forEach((p, i) => {
		if (p.type !== "tool-plan_init") return;
		const ok = (p.output as { ok?: unknown } | undefined)?.ok;
		if (ok === true) idx = i;
	});
	return idx;
}

export function projectView(messages: readonly OwllyMessage[], live?: LiveTurnState): OwllyViewMessage[] {
	const out: OwllyViewMessage[] = [];
	const outputErrors = new Map<string, ToolResultMessage>();
	for (const message of messages) {
		if (message.role === "toolResult" && message.toolName === SEND_TO_USER_TOOL && message.isError) {
			outputErrors.set(message.toolCallId, message);
		}
	}

	const lastAssistant = (): OwllyViewMessage | undefined => {
		const last = out[out.length - 1];
		return last && last.role === "assistant" ? last : undefined;
	};
	const findToolPart = (result: OwllyMessage & ToolResultMessage): OwllyViewPart | undefined => {
		for (let i = out.length - 1; i >= 0; i--) {
			const parts = out[i]!.parts;
			for (let p = parts.length - 1; p >= 0; p--) {
				const part = parts[p]!;
				if (!part.type.startsWith("tool-") || part.toolCallId !== result.toolCallId) continue;
				if (part.pluginQuestion) {
					const occurrence = { messageId: part.sourceMessageId!, contentIndex: part.sourceContentIndex!, toolCallId: part.toolCallId!, toolName: part.type.slice(5) };
					if (pluginQuestionResultMatches(result, occurrence, part.pluginQuestion) || (result.isError && part.pluginQuestion.status !== "posed")) return part;
					continue;
				}
				if (!result.owllyQuestionOccurrence && !readPluginQuestionCancellation(result.details)) return part;
			}
		}
		return undefined;
	};

	const compaction = activeCompactionOf(messages);

	for (const m of messages) {
		const role = (m as { role?: string }).role;

		if (compaction && m.id === compaction.details.firstKeptMessageId) {
			out.push({
				id: `cut_${compaction.id}`,
				role: "user",
				parts: [
					{
						type: "data-compaction-cut",
						id: `cc_${compaction.id}`,
						data: { content: compaction.content, details: compaction.details },
					},
				],
			});
		}

		if (role === "user") {
			const content = m.content as string | Array<{ type: string; text?: string }>;
			const parts = typeof content === "string" ? [textPart(content)] : content.flatMap((block): OwllyViewPart[] => {
				if (block.type === "text") return [textPart(block.text as string)];
				if (block.type === "image") return [{ ...block as ImageContent }];
				return [];
			});
			out.push({ id: m.id, role: "user", parts });
			continue;
		}

		if (role === "custom") {
			projectMarker(m as OwllyMarkerMessage, out);
			continue;
		}

		if (role === "toolResult") {
			applyResultTo(findToolPart(m as OwllyMessage & ToolResultMessage), m as ToolResultMessage);
			continue;
		}

		if (role === "assistant") {
			const assistant = m as AssistantMessage;
			const rest: OwllyViewPart[] = [];
			const reasoning: OwllyViewPart[] = [];
			let textN = 0;
			let reasoningN = 0;
			const streamingMessage = live?.streamingIds.has(m.id) === true;
			for (const [contentIndex, block] of assistant.content.entries()) {
				if (block.type === "text") {
					rest.push({ type: "text", id: `${m.id}-t${textN++}`, text: block.text, state: "done" });
				} else if (block.type === "thinking") {
					reasoning.push({ type: "reasoning", id: `${m.id}-r${reasoningN++}`, text: block.thinking, state: "done" });
				} else if (block.type === "toolCall") {
					const annotation = readPluginQuestionMessageAnnotation(m, contentIndex);
					if (annotation.status !== "absent") {
						rest.push({ type: `tool-${block.name}`, toolCallId: block.id,
							sourceMessageId: m.id, sourceContentIndex: contentIndex, pluginQuestion: annotation,
							state: annotation.status === "posed" ? "input-available" : streamingMessage ? "input-streaming" : "output-error" });
						continue;
					}
					const part = toolPartOf(block, live, streamingMessage);
					const pluginProblem = pluginProblemForCall(messages, { messageId: m.id, contentIndex, toolCallId: block.id, toolName: block.name });
					if (pluginProblem) { part.pluginProblem = pluginProblem; part.input = pluginProblem.input; }
					if ((QUESTION_TOOLS as readonly string[]).includes(block.name)) {
						part.sourceMessageId = m.id;
						part.sourceContentIndex = contentIndex;
					}
					if (block.name === SEND_TO_USER_TOOL) {
						if (assistant.stopReason === "error" || assistant.stopReason === "aborted") continue;
						const error = outputErrors.get(block.id);
						if (error) applyResult(part, error);
						if (part.state === "output-error") {
							rest.push(part);
						} else {
							const text = sendToUserText(block);
							if (text !== undefined) {
								rest.push({ type: "text", id: `${m.id}-t${textN++}`, text, state: "done" });
							}
						}
						continue;
					}
					if (block.name === PRACTICE_CONCLUDE_TOOL) {
						part.reveal = modelSolutionForConclude(messages, block.id);
						part.problemInput = problemInputForConclude(messages, block.id);
					}
					rest.push(part);
				}
			}
			const parts: OwllyViewPart[] = [...reasoning, ...rest];
			if (parts.length === 0) {
				if (live?.streamingIds.has(m.id)) {
					parts.push({ type: "reasoning", id: `${m.id}-r0`, text: "", state: "done" });
				} else {
					continue;
				}
			}
			const group = lastAssistant();
			if (group) {
				group.parts.push({ type: "step-start", sourceMessageId: m.id }, ...parts);
			} else {
				out.push({ id: m.id, role: "assistant", parts: [{ type: "step-start", sourceMessageId: m.id }, ...parts] });
			}
			continue;
		}
	}

	return out;
}

function isPlaceholderResultTool(name: string): boolean {
	return (QUESTION_TOOLS as readonly string[]).includes(name) || name === "problem";
}

function toolPartOf(
	block: { id: string; name: string; arguments?: unknown },
	live: LiveTurnState | undefined,
	streamingMessage: boolean,
): OwllyViewPart {
	const part: OwllyViewPart = {
		type: `tool-${block.name}`,
		toolCallId: block.id,
		input: block.arguments,
	};
	const exec = live?.executions.get(block.id);
	const isQuestion = isPlaceholderResultTool(block.name);
	if (exec) {
		if (exec.result) part.result = exec.result;
		if (exec.isError) {
			part.state = "output-error";
			part.rawInput = block.arguments;
			part.errorText = exec.errorText ?? "The tool call failed.";
		} else if (isQuestion) {
			part.state = "input-available";
		} else {
			part.state = "output-available";
			part.output = exec.output;
		}
	} else {
		part.state = streamingMessage ? "input-streaming" : "input-available";
	}
	return part;
}

function applyResultTo(part: OwllyViewPart | undefined, result: ToolResultMessage): void {
	if (part) {
		const tool = part.type.startsWith("tool-") ? part.type.slice("tool-".length) : part.type;
		const isQuestion = isPlaceholderResultTool(tool);
		if (!result.isError && ((isQuestion && result.details == null) || part.pluginProblem)) {
			part.state = "input-available";
			return;
		}
		applyResult(part, result);
	}
}

function projectMarker(marker: OwllyMarkerMessage, out: OwllyViewMessage[]): void {
	switch (marker.customType) {
		case "graph-context": {
			out.push({
				id: marker.id,
				role: "user",
				parts: [{ type: "data-graph-context", id: `gc_${marker.id}`, data: marker.details }],
			});
			return;
		}
		case "probe-handoff": {
			out.push({
				id: marker.id,
				role: "user",
				parts: [{ type: "data-probe-handoff", id: `ph_${marker.id}`, data: marker.details }],
			});
			return;
		}
		case "subagent-steer": {
			const meta = marker.details as SubagentResultMeta;
			const artifact = marker.details as {
				kind: SubagentArtifactData["kind"];
				result: SubagentArtifactData["result"];
				ui?: SubagentArtifactData["ui"];
			};
			out.push({
				id: marker.id,
				role: "user",
				metadata: { subagentResult: meta },
				parts: [
					textPart(marker.content),
					{
						type: "data-subagent-artifact",
						id: `sa_${marker.id}`,
						data: { kind: artifact.kind, result: artifact.result, ui: artifact.ui },
					},
				],
			});
			return;
		}
		case "subagent-abort": {
			const meta = marker.details as SubagentResultMeta & { aborted: true };
			out.push({
				id: marker.id,
				role: "user",
				metadata: { subagentResult: meta },
				parts: [textPart(marker.content), { type: "data-subagent-aborted", id: `sa_${marker.id}`, data: meta }],
			});
			return;
		}
		case "plugin-problem-submission": {
			out.push({ id: marker.id, role: "user", parts: [{ type: "data-plugin-problem-submission", id: `ps_${marker.id}`, data: marker.details }] });
			return;
		}
		case "practice-thinking": {
			out.push({
				id: marker.id,
				role: "user",
				parts: [{ type: "data-practice-thinking", id: `pt_${marker.id}`, data: marker.details }],
			});
			return;
		}
		case "practice-next": {
			out.push({
				id: marker.id,
				role: "user",
				parts: [{ type: "data-practice-next", id: `pn_${marker.id}`, data: null }],
			});
			return;
		}
		case "side-question":
		case "side-question-told":
			return;
		case "problem-dismissed":
			return;
		case "compaction": {
			out.push({
				id: marker.id,
				role: "user",
				parts: [
					{
					type: "data-compaction",
					id: `cm_${marker.id}`,
					data: { content: marker.content, details: marker.details as CompactionDetails },
				},
				],
			});
			return;
		}
		case "plan-block": {
			const group = out[out.length - 1];
			if (!group || group.role !== "assistant") return;
			const idx = lastSuccessfulPlanInit(group.parts);
			if (idx === -1) return;
			const { block } = marker.details as { planCallId: string; block: PlanBlockData };
			group.parts.splice(idx + 1, 0, { type: "data-plan-block", id: marker.id, data: block });
			return;
		}
	}
}
