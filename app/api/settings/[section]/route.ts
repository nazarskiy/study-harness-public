
import { type ChatSettings, type ModelsSettings } from "@/src/core";
import {
	SETTINGS_SECTIONS,
	clampChatLevel,
	clampModelsLevels,
	effectiveSettings,
	fileAccessConfigurationError,
	readSettingsRecord,
	refreshWorkerRequestAdmission,
	validateChatSettings,
	validateModelsSettings,
	writeSettingsRecord,
	type SettingsBodyResult,
} from "@/src/server";

export const dynamic = "force-dynamic";

type AnySectionParser = (body: unknown) => SettingsBodyResult<unknown>;

export async function PUT(request: Request, ctx: { params: Promise<{ section: string }> }) {
	const { section } = await ctx.params;
	const parser = (SETTINGS_SECTIONS as Record<string, AnySectionParser>)[section];
	if (!parser) {
		return Response.json(
			{ error: `unknown settings section "${section}"`, supported: Object.keys(SETTINGS_SECTIONS) },
			{ status: 404 },
		);
	}
	const body = await request.json().catch(() => null);
	const parsed = parser(body);
	if (!parsed.ok) {
		return Response.json({ error: parsed.error }, { status: 400 });
	}
	const record = readSettingsRecord() ?? { version: 1 };

	if (section === "chat") {
		const verdict = validateChatSettings(parsed.settings as ChatSettings);
		if (!verdict.ok) {
			return Response.json({ error: verdict.error, supported: verdict.supported }, { status: 400 });
		}
	}
	if (section === "models") {
		const verdict = validateModelsSettings(parsed.settings as ModelsSettings, record.models);
		if (!verdict.ok) {
			return Response.json({ error: verdict.error, supported: verdict.supported }, { status: 400 });
		}
	}

	const sectionOut =
		section === "chat"
			? clampChatLevel(parsed.settings as ChatSettings, effectiveSettings().models.strong)
			: section === "models"
				? clampModelsLevels(parsed.settings as ModelsSettings)
				: parsed.settings;

	const next = { ...record, [section]: sectionOut };
	const stored = writeSettingsRecord(next);
	refreshWorkerRequestAdmission();
	const fileAccessError = fileAccessConfigurationError();
	return Response.json({ settings: stored, ...(fileAccessError ? { fileAccessError } : {}) });
}
