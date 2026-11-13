import * as fs from "node:fs";
import * as path from "node:path";
import { PATHS, GRAPH_FORMAT_FILE, RENDER_SETTINGS_FILE } from "../../config.ts";
import packageJson from "../../package.json";
import { emit, subscribe } from "../core/events.ts";
import { createPluginAgentService } from "../agent/plugin-agents.ts";
import { createPluginWorkerService } from "../agent/plugin-workers.ts";
import { registerJobAbort, unregisterJobAbort } from "../agent/subagents/aborts.ts";
import { createPluginAgentRecordStore } from "../store/plugin-agent-records.ts";
import { createPluginTaskRecordStore, recoverPluginTaskRecords } from "../store/plugin-task-records.ts";
import corePluginIds from "../../core-plugins.json";
import { assertGraphFormat } from "../store/graph-format.ts";
import { createPluginLearningData } from "./plugin-learning.ts";
import { createPluginInference } from "./plugin-inference.ts";
import { createPluginBackgroundTool } from "./plugin-background-tools.ts";
import { registerPluginWorkerActivity } from "./plugin-worker-activity.ts";
import { deliverJobResult } from "./jobs.ts";
import { createPluginHost } from "./plugin-host.ts";
import { createPluginTransport } from "./plugin-transport.ts";
import { createPluginDocumentConverter } from "./plugin-documents.ts";
import type { AgentBuildOptions } from "../agent/teacher-agent.ts";
import { stores } from "./stores.ts";
import { isTurnRunning } from "./turn-liveness.ts";
import { compactionInFlight } from "./compaction.ts";

export const pluginDirectory = path.join( PATHS.data, "plugins");
const core = {
	directory: path.join( PATHS.root, "core-plugins"),
	dataDirectory: path.join( PATHS.data, "core-plugin-data"),
	ids: corePluginIds,
};
const coreData = { directory: core.dataDirectory, ids: core.ids };
type Host = ReturnType<typeof createPluginHost>;
interface Runtime { host: Host; ready: Promise<void> }
interface PluginGlobal { __lhPlugins?: Runtime }

function runtime(): Runtime {
	const global = globalThis as typeof globalThis & PluginGlobal;
	if (global.__lhPlugins) return global.__lhPlugins;
	const learning = createPluginLearningData({
		directory: PATHS.data, chatStore: stores.chatStore, graphStore: stores.graphStore,
		isBusy: isTurnRunning, isCompacting: compactionInFlight,
		readMetadata(name) {
			assertGraphFormat();
			try { return JSON.parse(fs.readFileSync(name === "format.json" ? GRAPH_FORMAT_FILE : RENDER_SETTINGS_FILE, "utf8")); }
			catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
		},
	});
	const installationErrors: Record<string, string> = Object.create(null);
	const host = createPluginHost({
		directory: pluginDirectory, core, appVersion: packageJson.version, installationErrors,
		convertDocument: createPluginDocumentConverter().convert,
		createServices({ manifest, dataDirectory, signal }) {
			const inference = createPluginInference({ signal, dataDirectory });
			const agents = createPluginAgentService({
				store: createPluginAgentRecordStore(path.join( dataDirectory, "agents")),
				engineFor: inference.engineFor, onUsage: inference.onUsage, signal,
				onChange: () => { if (!signal.aborted) emit("plugin-message", { pluginId: manifest.id, topic: "agents-changed" }); },
			});
			const workerActivity = registerPluginWorkerActivity({
				pluginId: manifest.id, pluginName: manifest.name, signal,
				cancel: taskId => workers.cancel(taskId),
			});
			const workers = createPluginWorkerService({
				store: createPluginTaskRecordStore(path.join( dataDirectory, "tasks")),
				engineFor: inference.engineFor, onUsage: inference.onUsage, signal,
				onChange: workerActivity,
			});
			return { learning, inference: inference.inference, agents, workers,
				createBackgroundTool(context, definition) {
					return createPluginBackgroundTool({
						pluginId: manifest.id, context, definition, workers, signal, jobStore: stores.jobStore,
						deliver: deliverJobResult, isActive: () => !signal.aborted,
						registerAbort: registerJobAbort, unregisterAbort: unregisterJobAbort,
					});
				},
			};
		},
		subscribeEvents: subscribe,
		onChange: () => emit("plugins-changed", {}),
		onNotification: (notification) => emit("plugin-message", notification),
	});
	const ready = Promise.resolve().then(async () => {
		for (const [id, error] of Object.entries(recoverPluginTaskRecords(pluginDirectory, coreData))) {
			installationErrors[id] = `Task recovery failed: ${error}`;
		}
		await host.initialize();
	});
	global.__lhPlugins = { host, ready };
	return global.__lhPlugins;
}

export async function initializePlugins(): Promise<void> { await runtime().ready; }
export async function getPluginHost(): Promise<Host> {
	const { host, ready } = runtime();
	await ready;
	return host;
}
export async function getPluginAgentContributions(): Promise<NonNullable<AgentBuildOptions["pluginContributions"]>> {
	return (await getPluginHost()).agentContributions;
}
export async function getPluginQuestionTypeResolver(): Promise<Host["resolveQuestionType"]> {
	return (await getPluginHost()).resolveQuestionType;
}
export const pluginTransport = createPluginTransport({ getHost: getPluginHost, directory: pluginDirectory });
