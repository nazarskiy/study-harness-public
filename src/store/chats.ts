
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { PATHS } from "../../config.ts";
import { emit } from "../core/events.ts";
import type { ChatStore } from "../core/ports.ts";
import type { ChatRecord, ChatSettings, ChatSummary, ExtractionRunUsage, ImageSnapshot, PlanTree, SideChatThread, TurnUsage } from "../core/contracts.ts";
import { CURRENT_CHAT_VERSION } from "../core/contracts.ts";
import type { OwllyMessage } from "../core/native-messages.ts";
import { activeProblemOf, danglingQuestionOf } from "../core/native-messages.ts";
import { phaseAt3Lh } from "../core/phases.ts";
import { removeLeftoverTemps, writeFileAtomicSync } from "./atomic-write.ts";

function chatFile(id: string): string {
	if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`Invalid chat id: ${id}`);
	return path.join( PATHS.chats, `${id}.json`);
}

function createChat(title: string, kind?: "practice"): ChatRecord {
	const now = new Date().toISOString();
	const record: ChatRecord = {
		id: `chat_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`,
		title: title.trim() || "Untitled session",
		createdAt: now,
		updatedAt: now,
		messages: [],
		...(kind === "practice" ? { kind: "practice" as const } : {}),
	};
	fs.mkdirSync(PATHS.chats, { recursive: true });
	writeChat(record);
	emit("chats-changed", {});
	return { ...record, version: CURRENT_CHAT_VERSION };
}

function writeChat(record: ChatRecord): void {
	writeFileAtomicSync(chatFile(record.id), JSON.stringify({ ...record, version: CURRENT_CHAT_VERSION }, null, "\t"), { allowInPlaceFallback: true });
}

function getChat(id: string): ChatRecord | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(fs.readFileSync( chatFile(id), "utf-8"));
	} catch {
		return null;
	}
	const v = (parsed as { version?: unknown }).version;
	if (typeof v === "number" && v > CURRENT_CHAT_VERSION) {
		console.error(`[chat ${id}] record stamped with schema version ${v} > ${CURRENT_CHAT_VERSION} — this app build is older; refusing to read it`);
		return null;
	}
	return parsed as ChatRecord;
}

function listChats(): ChatSummary[] {
	try {
		fs.mkdirSync(PATHS.chats, { recursive: true });
		return fs
			.readdirSync( PATHS.chats)
			.filter((f) => f.endsWith(".json"))
			.map((f) => getChat(f.slice(0, -5)))
			.filter((r): r is ChatRecord => r !== null)
			.map(({ messages, tree, turns, extractions, imageSnapshots: _imageSnapshots, sideChats: _sideChats, ...summary }) => {
				try {
					return {
						...summary,
						kind: summary.kind ?? "teach",
						messageCount: messages.length,
						phase: phaseAt3Lh(messages),
						pendingQuestion: danglingQuestionOf(messages) !== null,
						pendingProblem: activeProblemOf(messages) !== null,
					};
				} catch (err) {
					console.error(`[chat ${summary.id}] summary projection failed:`, err);
					return null;
				}
			})
			.filter((s) => s !== null)
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	} catch {
		return [];
	}
}

function saveMessages(id: string, messages: OwllyMessage[]): void {
	const record = getChat(id);
	if (!record) throw new Error(`Chat not found: ${id}`);
	record.messages = messages;
	record.updatedAt = new Date().toISOString();
	writeChat(record);
}

function saveImageSnapshot(id: string, snapshotId: string, image: ImageSnapshot): void {
	if (!/^[a-f0-9]{64}$/.test(snapshotId) || createHash("sha256").update(Buffer.from(image.data, "base64")).digest("hex") !== snapshotId) {
		throw new Error("Invalid image snapshot identity");
	}
	const record = getChat(id);
	if (!record) throw new Error(`Chat not found: ${id}`);
	if (record.imageSnapshots?.[snapshotId]) return;
	record.imageSnapshots = { ...record.imageSnapshots, [snapshotId]: {
		mimeType: image.mimeType, data: image.data, width: image.width, height: image.height,
	} };
	writeChat(record);
}

function appendTurnUsage(id: string, entry: TurnUsage): void {
	const record = getChat(id);
	if (!record) throw new Error(`Chat not found: ${id}`);
	record.turns = record.turns?.some((t) => t.id === entry.id)
		? record.turns
		: [...(record.turns ?? []), entry];
	writeChat(record);
}

function appendExtractionUsage(id: string, entry: ExtractionRunUsage): void {
	const record = getChat(id);
	if (!record) throw new Error(`Chat not found: ${id}`);
	record.extractions = record.extractions?.some((r) => r.startedAt === entry.startedAt)
		? record.extractions
		: [...(record.extractions ?? []), entry];
	writeChat(record);
}

function saveSettings(id: string, settings: ChatSettings): void {
	const record = getChat(id);
	if (!record) throw new Error(`Chat not found: ${id}`);
	record.settings = settings;
	writeChat(record);
}

function renameChat(id: string, title: string): ChatRecord {
	const record = getChat(id);
	if (!record) throw new Error(`Chat not found: ${id}`);
	record.title = title.trim() || "Untitled session";
	writeChat(record);
	emit("chats-changed", {});
	return record;
}

function deleteChat(id: string): boolean {
	try {
		fs.unlinkSync(chatFile(id));
		removeLeftoverTemps(chatFile(id));
		emit("chats-changed", {});
		return true;
	} catch {
		return false;
	}
}

function saveTree(id: string, tree: PlanTree): void {
	const record = getChat(id);
	if (!record) throw new Error(`Chat not found: ${id}`);
	record.tree = tree;
	writeChat(record);
}

function updateSideChats(id: string, update: (threads: SideChatThread[]) => SideChatThread[]): SideChatThread[] | null {
	const record = getChat(id);
	if (!record) return null;
	const next = update(record.sideChats ?? []);
	if (next.length > 0) record.sideChats = next;
	else delete record.sideChats;
	writeChat(record);
	return next;
}

export const chatStore: ChatStore = {
	createChat,
	getChat,
	listChats,
	saveMessages,
	saveImageSnapshot,
	saveTree,
	saveSettings,
	renameChat,
	deleteChat,
	appendTurnUsage,
	appendExtractionUsage,
	updateSideChats,
};
