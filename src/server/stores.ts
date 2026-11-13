
import { chatStore } from "../store/chats.ts";
import { graphStore } from "../store/graph.ts";
import { sourceOrganizationStore } from "../store/source-organization.ts";
import { jobStore } from "../store/jobs.ts";
import { settingsStore } from "../store/settings.ts";
import { resolveSettings, type EffectiveSettings } from "../core/settings-resolution.ts";
import { syncCustomProvider } from "./custom-provider.ts";
import { configureWorkerRequestAdmission } from "../agent/worker-request-admission.ts";
export const stores = {
	chatStore,
	graphStore,
	sourceOrganizationStore,
	jobStore,
	settingsStore,
};

export type Stores = typeof stores;

export function effectiveSettings(): EffectiveSettings {
	return resolveSettings(settingsStore.readSettings());
}

configureWorkerRequestAdmission(() => effectiveSettings().agent.workerRequestConcurrency);

syncCustomProvider();
