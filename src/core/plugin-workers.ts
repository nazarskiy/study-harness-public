export interface PluginTaskError {
	code: "no_result" | "max_turns" | "timeout" | "run_error" | "storage_error" | "cancelled" | "interrupted";
	message: string;
}
export type PluginTaskOutcome =
	| { id: string; status: "succeeded"; result: unknown }
	| { id: string; status: "failed" | "cancelled" | "interrupted"; error: PluginTaskError };
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
