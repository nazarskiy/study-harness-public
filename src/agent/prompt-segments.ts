
import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../../config.ts";
import { FRAGMENT_RE, type PromptAgent } from "../core/prompt-segments.ts";

const PROMPTS_DIR = path.join(PATHS.root, "src", "agent", "prompts");

const PRACTICE_SHARED_FRAGMENTS = ["10-voice.md", "15-accuracy.md", "16-mental-model.md", "35-side-conversations.md", "40-formatting.md"];

export function listSourceSegments(agent: PromptAgent): Array<{ path: string; shared: boolean; file: string }> {
	const segments: Array<{ path: string; shared: boolean; file: string }> = agent === "practice" ? [] : [
		{ path: "system-prompt.md", shared: true, file: PATHS.teacherPrompt },
	];
	const dir = path.join(PROMPTS_DIR, agent);
	if (fs.existsSync(dir)) {
		const fragments = fs.readdirSync(dir).filter((f) => FRAGMENT_RE.test(f)).sort();
		for (const f of fragments) {
			segments.push({ path: `${agent}/${f}`, shared: false, file: path.join(dir, f) });
		}
	}
	const sharedDir = path.join(PROMPTS_DIR, "shared");
	if (fs.existsSync(sharedDir)) {
		const allow = agent === "practice" ? PRACTICE_SHARED_FRAGMENTS : null;
		const sharedFragments = fs
			.readdirSync(sharedDir)
			.filter((f) => FRAGMENT_RE.test(f) && (allow === null || allow.includes(f)))
			.sort();
		for (const f of sharedFragments) {
			segments.push({ path: `shared/${f}`, shared: true, file: path.join(sharedDir, f) });
		}
	}
	return segments;
}
