
import * as fs from "node:fs";
import * as path from "node:path";
import { PATHS } from "../../config.ts";
import { emit } from "../core/events.ts";
import type { JobStore } from "../core/ports.ts";
import type { CreateJobInit, JobPatch } from "../core/ports.ts";
import type { JobRecord } from "../core/contracts.ts";
import { removeLeftoverTemps, writeFileAtomicSync } from "./atomic-write.ts";

const JOBS_DIR = path.join( PATHS.data, "jobs");

function jobFile(id: string): string {
	if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`Invalid job id: ${id}`);
	return path.join( JOBS_DIR, `${id}.json`);
}

function writeJob(record: JobRecord): void {
	const strict = record.kind === "plugin" || record.plugin !== undefined;
	writeFileAtomicSync(jobFile(record.id), JSON.stringify(record, null, "\t"), {
		allowInPlaceFallback: !strict,
		...(strict ? { mode: 0o600 } : {}),
	});
	if (strict && process.platform !== "win32") {
		const directory = fs.openSync(JOBS_DIR, "r");
		try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
	}
}

function createJob(init: CreateJobInit): JobRecord {
	const now = new Date().toISOString();
	const record: JobRecord = {
		id: `job_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`,
		kind: init.kind,
		chatId: init.chatId,
		toolCallId: init.toolCallId,
		...(init.input !== undefined ? { input: init.input } : {}),
		status: "running",
		activity: init.activity ?? "starting",
		createdAt: now,
		updatedAt: now,
		...(init.plugin ? { plugin: init.plugin } : {}),
	};
	fs.mkdirSync(JOBS_DIR, { recursive: true });
	writeJob(record);
	emit("jobs-changed", { chatId: init.chatId });
	return record;
}

function getJob(id: string): JobRecord | null {
	try {
		return JSON.parse(fs.readFileSync( jobFile(id), "utf-8")) as JobRecord;
	} catch {
		return null;
	}
}

function updateJob(id: string, patch: JobPatch): JobRecord | null {
	const record = getJob(id);
	if (!record) return null;
	const next: JobRecord = { ...record, ...patch, updatedAt: patch.updatedAt ?? new Date().toISOString() };
	writeJob(next);
	emit("jobs-changed", { chatId: next.chatId });
	return next;
}

function listJobs(chatId: string): JobRecord[] {
	try {
		fs.mkdirSync(JOBS_DIR, { recursive: true });
		return fs
			.readdirSync( JOBS_DIR)
			.filter((f) => f.endsWith(".json"))
			.map((f) => getJob(f.slice(0, -5)))
			.filter((j): j is JobRecord => j !== null && j.chatId === chatId)
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	} catch {
		return [];
	}
}

function findJobByToolCallId(chatId: string, toolCallId: string): JobRecord | null {
	return listJobs(chatId).find((j) => j.toolCallId === toolCallId) ?? null;
}

function deleteJobsForChat(chatId: string): number {
	let removed = 0;
	for (const job of listJobs(chatId)) {
		try {
			fs.unlinkSync(jobFile(job.id));
			removeLeftoverTemps(jobFile(job.id));
			removed++;
		} catch {
		}
	}
	if (removed > 0) emit("jobs-changed", { chatId });
	return removed;
}

export const jobStore: JobStore = {
	createJob,
	getJob,
	updateJob,
	listJobs,
	findJobByToolCallId,
	deleteJobsForChat,
};
