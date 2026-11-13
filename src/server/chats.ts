import { abortExtraction, extractionStatuses } from "../agent/subagents/extraction.ts";
import { isJobLive } from "../agent/subagents/aborts.ts";
import { coverageOf } from "../core/coverage.ts";
import { deleteChatTraces, type ChatDeleteMode, type ChatDeletionStats } from "../core/graph-deletion.ts";
import { titleFromPrompt } from "../core/contracts.ts";
import { graphRevision } from "./graph.ts";
import { stores } from "./stores.ts";
import { isTurnRunning } from "./turn-liveness.ts";
import { clearTurnFailure } from "./turn-runs.ts";
import { discardChatDeliveries } from "./jobs.ts";
import { sideChats } from "./side-chat.ts";


export const { createChat, getChat, listChats } = stores.chatStore;
export { titleFromPrompt };
export type { ChatDeleteMode, ChatDeletionStats } from "../core/graph-deletion.ts";

const WIND_DOWN_TIMEOUT_MS = 10_000;
const WIND_DOWN_POLL_MS = 50;

export type ChatDeleteOutcome =
	| { ok: false; status: 404; code: "not_found"; error: string }
	| { ok: false; status: 409; code: "turn_in_flight" | "jobs_running"; error: string; jobIds: string[] }
	| { ok: false; status: 503; code: "extraction_winding_down"; error: string }
	| {
			ok: true;
			mode: ChatDeleteMode;
			stats: ChatDeletionStats;
			jobsRemoved: number;
			graphRevision: number;
	  };

export function runningWorkBlocker(chatId: string): Extract<ChatDeleteOutcome, { status: 409 }> | null {
	if (isTurnRunning(chatId)) {
		return {
			ok: false,
			status: 409,
			code: "turn_in_flight",
			error: "A turn is running in this session — try again when it finishes",
			jobIds: [],
		};
	}
	const runningJobs = stores.jobStore.listJobs(chatId).filter((job) =>
		job.status === "running" && (!job.result || isJobLive(job.id)));
	if (runningJobs.length > 0) {
		return {
			ok: false,
			status: 409,
			code: "jobs_running",
			error: "Background jobs are still running in this session — try again when they finish",
			jobIds: runningJobs.map((job) => job.id),
		};
	}
	return null;
}

export async function deleteChatSession(chatId: string, mode: ChatDeleteMode): Promise<ChatDeleteOutcome> {
	if (!stores.chatStore.getChat(chatId)) {
		return { ok: false, status: 404, code: "not_found", error: "No such session" };
	}
	const blocker = runningWorkBlocker(chatId);
	if (blocker) return blocker;
	if (extractionStatuses().some((run) => run.chatId === chatId)) {
		abortExtraction(chatId);
		const deadline = Date.now() + WIND_DOWN_TIMEOUT_MS;
		while (extractionStatuses().some((run) => run.chatId === chatId)) {
			if (Date.now() > deadline) {
				return {
					ok: false,
					status: 503,
					code: "extraction_winding_down",
					error: "The session's extraction is still winding down — try again in a moment",
				};
			}
			await new Promise((resolve) => setTimeout(resolve, WIND_DOWN_POLL_MS));
		}
	}

	const lateBlocker = runningWorkBlocker(chatId);
	if (lateBlocker) return lateBlocker;

	return finishChatDeletion(chatId, mode);
}

export function deleteIdleChatRecord(chatId: string): Extract<ChatDeleteOutcome, { ok: false }> | { ok: true } {
	if (!stores.chatStore.getChat(chatId)) return { ok: false, status: 404, code: "not_found", error: "No such session" };
	const blocker = runningWorkBlocker(chatId);
	if (blocker) return blocker;
	if (extractionStatuses().some((run) => run.chatId === chatId)) return { ok: false, status: 503, code: "extraction_winding_down", error: "The session's extraction is still winding down — try again in a moment" };
	finishChatRecordDeletion(chatId);
	if (stores.chatStore.getChat(chatId)) throw new Error("Could not remove the selected session record.");
	return { ok: true };
}

function finishChatDeletion(chatId: string, mode: ChatDeleteMode): Extract<ChatDeleteOutcome, { ok: true }> {
	const stats = deleteChatTraces(stores.graphStore, chatId, mode);
	const jobsRemoved = finishChatRecordDeletion(chatId);
	return { ok: true, mode, stats, jobsRemoved, graphRevision: graphRevision() };
}

function finishChatRecordDeletion(chatId: string): number {
	const jobsRemoved = stores.jobStore.deleteJobsForChat(chatId);
	if (stores.chatStore.deleteChat(chatId)) {
		discardChatDeliveries(chatId);
		clearTurnFailure(chatId);
		sideChats.stopAll(chatId);
	}
	return jobsRemoved;
}

export interface SessionCoverage {
	totalMessages: number;
	coveredCount: number;
	uncoveredCount: number;
	coveredTokens: number;
	uncoveredTokens: number;
	running: boolean;
	lastFoldedAt: string | null;
}

export function sessionCoverage(chatId: string): SessionCoverage | null {
	const record = stores.chatStore.getChat(chatId);
	if (!record) return null;
	const entries = stores.graphStore.readCoverage();
	const cov = coverageOf(record.messages, entries, chatId);
	let lastFoldedAt: string | null = null;
	for (const entry of entries) {
		if (entry.chatId !== chatId) continue;
		if (lastFoldedAt === null || entry.foldedAt > lastFoldedAt) lastFoldedAt = entry.foldedAt;
	}
	return {
		totalMessages: cov.slots.length,
		coveredCount: cov.coveredCount,
		uncoveredCount: cov.uncoveredCount,
		coveredTokens: cov.coveredTokens,
		uncoveredTokens: cov.uncoveredTokens,
		running: extractionStatuses().some((run) => run.kind === "chat" && run.chatId === chatId),
		lastFoldedAt,
	};
}
