import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { BackgroundModelRole, ModelSlotName, ModelSlot } from "../settings.ts";

export interface ModelCatalogEntry {
	id: string;
	name: string;
	provider: string;
	reasoning: boolean;
	input: ("text" | "image")[];
	supportedLevels: ThinkingLevel[];
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number } | null;
	contextWindow: number | null;
	maxTokens: number | null;
}

export interface CatalogDefaults {
	model: { provider: string; id: string };
	thinkingLevel?: ThinkingLevel;
}

export type RolePins = Record<
	BackgroundModelRole,
	{ model: { provider: string; id: string }; thinkingLevel?: ThinkingLevel } | null
>;

export type SlotPins = Record<ModelSlotName, (ModelSlot & { model: { provider: string; id: string } }) | null>;

export interface ModelCatalogResponse {
	models: ModelCatalogEntry[];
	defaults: CatalogDefaults | null;
	rolePins: RolePins;
	slots: SlotPins;
	providers: CatalogProvider[];
}

export interface CatalogProvider {
	id: string;
	envVar: string;
	keyPresent: boolean;
}