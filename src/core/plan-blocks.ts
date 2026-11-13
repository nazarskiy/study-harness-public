
import type { PlanBlockData, PlanTree } from "./contracts.ts";
import { derivePlanStatusesLh } from "./contracts.ts";
import type { OwllyMessage } from "./native-messages.ts";
import { newPlanBlockMessage } from "./native-messages.ts";
import type { ToolResultMessage } from "@earendil-works/pi-ai";

export interface PlanBlockPart {
	type: "data-plan-block";
	id: string;
	data: PlanBlockData;
}

function snapshot(tree: PlanTree, messages: readonly OwllyMessage[]): PlanBlockData {
	const statuses = derivePlanStatusesLh(tree, messages);
	return {
		kind: "full",
		at: new Date().toISOString(),
		current: statuses.current,
		nodes: tree.nodes.map((n) => ({
			id: n.id,
			title: n.title,
			status: statuses.current === n.id ? "current" : statuses.visited.has(n.id) ? "visited" : "upcoming",
		})),
		edges: tree.edges.map((e) => ({ from: e.from, to: e.to })),
	};
}

export function emittedPlanBlockCalls(messages: readonly OwllyMessage[]): Set<string> {
	const out = new Set<string>();
	for (const m of messages) {
		if ((m as { role?: string }).role !== "custom") continue;
		const marker = m as { customType?: string; details?: { planCallId?: unknown } };
		if (marker.customType === "plan-block" && typeof marker.details?.planCallId === "string") {
			out.add(marker.details.planCallId);
		}
	}
	return out;
}

export function planBlocksFor(
	record: readonly OwllyMessage[],
	newMessages: readonly OwllyMessage[],
	tree: PlanTree | null | undefined,
	transcript: readonly OwllyMessage[],
): OwllyMessage[] {
	if (!tree || tree.nodes.length === 0) return [];
	const emitted = emittedPlanBlockCalls(record);
	let last: { toolCallId: string } | null = null;
	for (const m of newMessages) {
		if ((m as { role?: string }).role !== "toolResult") continue;
		const result = m as ToolResultMessage & { id: string };
		if (result.toolName !== "plan_init") continue;
		const ok = (result.details as { ok?: unknown } | undefined)?.ok;
		if (ok !== true) continue;
		if (emitted.has(result.toolCallId)) continue;
		last = { toolCallId: result.toolCallId };
	}
	if (!last) return [];
	return [newPlanBlockMessage(last.toolCallId, snapshot(tree, transcript))];
}
