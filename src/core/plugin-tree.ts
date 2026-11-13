import type { PluginUiCallback, PluginUiContent } from "./plugin-ui.ts";

export type PluginTreeContent = string | PluginUiContent;
export interface PluginTreeColumn {
	key: string;
	header: PluginTreeContent;
	width: number | string;
	align?: "left" | "right";
}
export interface PluginTreeRow {
	key: string;
	content: PluginTreeContent;
	cells?: Record<string, PluginTreeContent>;
	children?: readonly PluginTreeRow[];
	selection?: {
		label: string;
		checked: boolean;
		indeterminate?: boolean;
		disabled?: boolean;
		onChange: PluginUiCallback<boolean>;
	};
	disclosure?: {
		label: string;
		expanded: boolean;
		onChange: PluginUiCallback<boolean>;
	};
}
export interface PluginTreeProps {
	label: string;
	rows: readonly PluginTreeRow[];
	header?: PluginTreeContent;
	columns?: readonly PluginTreeColumn[];
}
