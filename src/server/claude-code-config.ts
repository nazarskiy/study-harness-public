import { getClaudeBinary } from "../agent/claude-code/binary.ts";
import { settingsStore } from "../store/settings.ts";

export function claudeCodeEnabled(): boolean {
	return settingsStore.readSettings()?.claudeCode?.enabled === true;
}

export function claudeCodeAvailable(): boolean {
	return claudeCodeEnabled() && getClaudeBinary() !== null;
}
