import type { AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { Static, TSchema } from "typebox";
import type { JobUsage } from "./contracts/jobs.ts";
import type { PluginCallPurpose, PluginModelSpec } from "./plugin-agents.ts";
import type { PluginInferenceOptions, PluginToolContext } from "./plugins.ts";

export interface PluginWorkerContext {
	readonly taskId: string;
	readonly input: unknown;
	readonly signal: AbortSignal;
}
export interface PluginWorkerDefinition {
	id: string;
	instructions: string;
	resultSchema: TSchema;
	tools?: (context: PluginWorkerContext) => AgentTool<any>[];
	validateResult?: (result: unknown, context: PluginWorkerContext) => void | Promise<void>;
}
export interface PluginWorkerStartOptions {
	requestId: string;
	input: unknown;
	prompt: string;
	model: PluginModelSpec;
	purpose: PluginCallPurpose;
	maxTurns: number;
	options?: PluginInferenceOptions;
	timeoutMs?: number;
}
export type PluginTaskStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "interrupted";
export interface PluginTaskError {
	code: "no_result" | "max_turns" | "timeout" | "run_error" | "storage_error" | "cancelled" | "interrupted";
	message: string;
}
export interface PluginTaskRecord extends PluginWorkerStartOptions {
	version: 1;
	id: string;
	definitionId: string;
	createdAt: string;
	updatedAt: string;
	completedAt?: string;
	status: PluginTaskStatus;
	messages: AgentMessage[];
	turns: number;
	activity?: string;
	usage?: JobUsage;
	result?: unknown;
	error?: PluginTaskError;
}
export interface PluginTaskSnapshot extends PluginTaskRecord {
	partial?: AssistantMessage;
}
export type PluginTaskOutcome =
	| { id: string; status: "succeeded"; result: unknown }
	| { id: string; status: "failed" | "cancelled" | "interrupted"; error: PluginTaskError };
export type PluginBackgroundTool<T extends TSchema = TSchema> = Omit<AgentTool<T>, "execute"> & {
	workerId: string;
	prepare(input: Static<T>, context: PluginToolContext):
		Omit<PluginWorkerStartOptions, "requestId" | "purpose"> | Promise<Omit<PluginWorkerStartOptions, "requestId" | "purpose">>;
	format(outcome: PluginTaskOutcome, context: PluginToolContext): PluginBackgroundPresentation | Promise<PluginBackgroundPresentation>;
};
export interface PluginBackgroundPresentation {
	text: string;
	data?: unknown;
}
export interface PluginBackgroundResult extends PluginBackgroundPresentation {
	pluginId: string;
	toolName: string;
	input: unknown;
	outcome: PluginTaskOutcome;
	formatError?: string;
}
export interface PluginBackgroundMeta {
	pluginId: string;
	taskId: string;
	status: PluginTaskOutcome["status"];
}
export interface PluginWorkerService {
	register(definition: PluginWorkerDefinition): () => void;
	start(definitionId: string, options: PluginWorkerStartOptions): PluginTaskSnapshot;
	list(): PluginTaskSnapshot[];
	get(id: string): PluginTaskSnapshot;
	subscribe(id: string, listener: (snapshot: PluginTaskSnapshot) => void): () => void;
	wait(id: string, signal?: AbortSignal): Promise<PluginTaskOutcome>;
	cancel(id: string): void;
	dispose(): Promise<void>;
}
