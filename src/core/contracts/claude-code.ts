export const CLAUDE_CODE_PROVIDER = "claude-code";

export interface ClaudeCodeStatus {
	state: "not-found" | "meets-minimum" | "update-required" | "version-unchecked";
	version: string | null;
	minimumVersion: string;
}

export const CLAUDE_CODE_MINIMUM_VERSION = "2.1.259";
