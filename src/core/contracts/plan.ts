
export interface PlanNode {
	id: string;
	title: string;
	summary?: string;
}

export interface PlanEdge {
	from: string;
	to: string;
}

export interface PlanTree {
	nodes: PlanNode[];
	edges: PlanEdge[];
	version: number;
}


export type PlanNodeStatus = "current" | "visited" | "upcoming";


interface PartsCarrier {
	parts: Array<{ type: string; state?: string; input?: unknown; output?: unknown; pluginQuestion?: unknown }>;
}

export interface DerivedPlanStatuses {
	current: string | null;
	visited: ReadonlySet<string>;
}

export function derivedNodeStatus(statuses: DerivedPlanStatuses, nodeId: string): PlanNodeStatus {
	if (statuses.current === nodeId) return "current";
	if (statuses.visited.has(nodeId)) return "visited";
	return "upcoming";
}

export function derivePlanStatuses(tree: PlanTree, messages: readonly PartsCarrier[]): DerivedPlanStatuses {
	const ids = new Set(tree.nodes.map((n) => n.id));
	const runs: string[] = [];
	for (const m of messages) {
		for (const part of m.parts) {
			const snapshot = posedPluginQuestionOfPart(part);
			if (part.pluginQuestion !== undefined ? snapshot?.variant !== "teach" : part.type !== "tool-quiz" && part.type !== "tool-explain") continue;
			const nodeId = ((snapshot?.input ?? part.input) as { nodeId?: unknown } | undefined)?.nodeId;
			if (typeof nodeId !== "string" || !ids.has(nodeId)) continue;
			if (runs.at(-1) !== nodeId) runs.push(nodeId);
		}
	}
	const current = runs.at(-1) ?? null;
	const visited = new Set(runs.slice(0, -1));
	return { current, visited };
}

export interface PlanToolResult {
	ok: boolean;
	error?: string;
	tree?: PlanTree;
}



import type { OwllyMessage } from "../native-messages.ts";
import { posedPluginQuestionOfPart } from "../tool-parts.ts";
import { readPluginQuestionMessageAnnotation } from "../plugin-questions.ts";

export function derivePlanStatusesLh(tree: PlanTree, messages: readonly OwllyMessage[]): DerivedPlanStatuses {
	const ids = new Set(tree.nodes.map((n) => n.id));
	const runs: string[] = [];
	for (const m of messages) {
		if ((m as { role?: string }).role !== "assistant") continue;
		const content = (m as { content?: unknown }).content;
		if (!Array.isArray(content)) continue;
		for (const [contentIndex, block] of (content as Array<{ type?: string; name?: string; arguments?: unknown }>).entries()) {
			const annotation = readPluginQuestionMessageAnnotation(m, contentIndex);
			if (block.type !== "toolCall") continue;
			if (annotation.status !== "absent" ? annotation.status !== "posed" || annotation.snapshot.variant !== "teach" : block.name !== "quiz" && block.name !== "explain") continue;
			const input = annotation.status === "posed" ? annotation.snapshot.input : block.arguments;
			const nodeId = (input as { nodeId?: unknown } | undefined)?.nodeId;
			if (typeof nodeId !== "string" || !ids.has(nodeId)) continue;
			if (runs.at(-1) !== nodeId) runs.push(nodeId);
		}
	}
	const current = runs.at(-1) ?? null;
	const visited = new Set(runs.slice(0, -1));
	return { current, visited };
}
