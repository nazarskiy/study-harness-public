
import { extractionStatuses, type ExtractionPhase } from "../agent/subagents/extraction.ts";
import { chatStore } from "../store/chats.ts";
import { graphRevision } from "./graph.ts";
import { catalogContextLimits } from "./model-catalog.ts";
import { listJobs } from "./jobs.ts";
import { jobCost } from "./pricing.ts";
import { pluginWorkerActivities, type PluginWorkerActivity } from "./plugin-worker-activity.ts";
import type { JobRecord } from "../core/contracts.ts";

export { abortExtraction, extractionStatuses, type ExtractionPhase, type RunningExtraction } from "../agent/subagents/extraction.ts";
export { chatStore } from "../store/chats.ts";

export interface ActivityJob extends JobRecord {
	costUsd: number | null;
	title: string;
	contextLimit: number | null;
}

export interface ActivityPluginWorker extends PluginWorkerActivity {
	costUsd: number | null;
	contextLimit: number | null;
}

export interface ActivityExtraction {
	id: string;
	chatId: string;
	part?: { i: number; n: number };
	title: string;
	phase: ExtractionPhase;
	startedAt: number;
}

export function activityFeed(): {
	jobs: ActivityJob[];
	pluginWorkers: ActivityPluginWorker[];
	extractions: ActivityExtraction[];
	graphRevision: number;
} {
	const chats = chatStore.listChats();
	const limits = catalogContextLimits();
	const jobs: ActivityJob[] = [];
	for (const chat of chats) {
		for (const job of listJobs(chat.id)) {
			if (job.status === "running") {
				jobs.push({
					...job,
					costUsd: jobCost(job),
					title: chat.title ?? chat.id,
					contextLimit: job.usage ? (limits.get(job.usage.model) ?? null) : null,
				});
			}
		}
	}
	const extractions: ActivityExtraction[] = extractionStatuses().map((run) => ({
		id: run.part ? `${run.chatId}#${run.part.i}` : run.chatId,
		chatId: run.chatId,
		part: run.part,
		title:
			(run.label ?? chatStore.getChat(run.chatId)?.title ?? run.chatId) +
			(run.part ? ` · ${run.part.i}/${run.part.n}` : ""),
		phase: run.phase,
		startedAt: run.startedAt,
	}));
	const linked = new Set(jobs.flatMap(job => job.kind === "plugin" && job.plugin?.taskId
		? [`${job.plugin.pluginId}:${job.plugin.taskId}`] : []));
	const pluginWorkers: ActivityPluginWorker[] = pluginWorkerActivities()
		.filter(task => !linked.has(task.id))
		.map(task => ({ ...task, costUsd: jobCost(task),
			contextLimit: task.usage ? (limits.get(task.usage.model) ?? null) : null }))
		.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
	jobs.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
	return {
		jobs,
		pluginWorkers,
		extractions: extractions.sort((a, b) => a.startedAt - b.startedAt),
		graphRevision: graphRevision(),
	};
}
