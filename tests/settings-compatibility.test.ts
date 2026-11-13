import assert from "node:assert/strict";
import { test } from "node:test";
import { sanitizeUserSettings } from "../src/core/settings.ts";
import { resolveSettings } from "../src/core/settings-resolution.ts";

test("retired speech preferences cannot affect active settings in existing profiles", () => {
	const profile = {
		version: 1,
		appearance: { mode: "dark", proseFontSize: 20 },
		models: { strong: { model: { provider: "custom", id: "local-model" } } },
		agent: { workerRequestConcurrency: 3 },
		graph: { enabled: false },
	};
	const expected = resolveSettings(sanitizeUserSettings(profile));
	for (const dictation of [{ language: "cs" }, { language: "multi" }, null, "obsolete-value"]) {
		const record = sanitizeUserSettings({ ...profile, dictation });
		assert.ok(record);
		assert.deepEqual(resolveSettings(record), expected);
		assert.equal(record.appearance?.mode, "dark");
		assert.equal(record.models?.strong?.model?.id, "local-model");
		assert.equal(record.agent?.workerRequestConcurrency, 3);
		assert.equal(record.graph?.enabled, false);
	}
});
