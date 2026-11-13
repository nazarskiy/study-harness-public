
import { createHash } from "node:crypto";

import type { CoverageEntry } from "./contracts/graph.ts";
import { failedOutputCallIds, userFacingTextOf, type OwllyMessage } from "./native-messages.ts";

export type { CoverageEntry };

export function messageViewLines(
	message: OwllyMessage,
	mid: string,
	failedOutputCalls: ReadonlySet<string> = failedOutputCallIds([message]),
): string[] {
	const lines: string[] = [];
	if ((message as { role?: string }).role !== "assistant") return lines;
	for (const text of userFacingTextOf((message as { content: unknown }).content, failedOutputCalls)) {
		lines.push(`TEACHER [${mid}] ${text.trim()}`);
	}
	return lines;
}

export function teacherProseBlocks(messages: ReadonlyArray<OwllyMessage>): string[] {
	const out: string[] = [];
	const failedOutputCalls = failedOutputCallIds(messages);
	for (const message of messages) {
		if ((message as { role?: string }).role !== "assistant") continue;
		for (const text of userFacingTextOf((message as { content: unknown }).content, failedOutputCalls)) out.push(text.trim());
	}
	return out;
}

export function viewTokens(lines: string[]): number {
	return Math.ceil(lines.join("\n").length / 4);
}

export function messageFingerprint(message: OwllyMessage, failedOutputCalls?: ReadonlySet<string>): string {
	const h = createHash("sha256");
	h.update(JSON.stringify([(message as { role?: string }).role, messageViewLines(message, message.id, failedOutputCalls)]));
	return h.digest("hex");
}

export interface CoverageSlot {
	message: OwllyMessage;
	fp: string;
	tokens: number;
}

export function coverageSlots(messages: ReadonlyArray<OwllyMessage>): CoverageSlot[] {
	const failedOutputCalls = failedOutputCallIds(messages);
	return messages.map((message) => ({
		message,
		fp: messageFingerprint(message, failedOutputCalls),
		tokens: viewTokens(messageViewLines(message, message.id, failedOutputCalls)),
	}));
}

export function coveredSet(entries: ReadonlyArray<CoverageEntry>, chatId: string): Set<string> {
	const out = new Set<string>();
	for (const e of entries) if (e.chatId === chatId) out.add(e.fp);
	return out;
}

export function coverageOf(
	messages: ReadonlyArray<OwllyMessage>,
	entries: ReadonlyArray<CoverageEntry>,
	chatId: string,
): {
	slots: CoverageSlot[];
	uncovered: number[];
	coveredTokens: number;
	uncoveredTokens: number;
	coveredCount: number;
	uncoveredCount: number;
} {
	const covered = coveredSet(entries, chatId);
	const slots = coverageSlots(messages);
	const uncovered: number[] = [];
	let coveredTokens = 0;
	let uncoveredTokens = 0;
	for (let i = 0; i < slots.length; i++) {
		const slot = slots[i]!;
		if (slot.tokens === 0) continue;
		if (covered.has(slot.fp)) coveredTokens += slot.tokens;
		else {
			uncovered.push(i);
			uncoveredTokens += slot.tokens;
		}
	}
	const visibleCount = slots.filter((s) => s.tokens > 0).length;
	return {
		slots,
		uncovered,
		coveredTokens,
		uncoveredTokens,
		coveredCount: visibleCount - uncovered.length,
		uncoveredCount: uncovered.length,
	};
}

export function batchRuns(slots: ReadonlyArray<CoverageSlot>, uncovered: ReadonlyArray<number>, budget: number): CoverageSlot[][] {
	if (budget <= 0 || uncovered.length === 0) return [];
	const runs: CoverageSlot[][] = [];
	let current: CoverageSlot[] = [];
	let currentTokens = 0;
	const flush = () => {
		if (current.length > 0) runs.push(current);
		current = [];
		currentTokens = 0;
	};
	for (const i of uncovered) {
		const slot = slots[i]!;
		if (current.length > 0 && currentTokens + slot.tokens > budget) flush();
		current.push(slot);
		currentTokens += slot.tokens;
	}
	flush();
	return runs;
}

export function batchTag(batch: ReadonlyArray<CoverageSlot>): string {
	const h = createHash("sha256");
	for (const slot of batch) h.update(slot.fp);
	return h.digest("hex").slice(0, 12);
}
