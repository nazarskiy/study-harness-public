import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { PluginTreeProps } from "./plugin-tree.ts";

export type PluginUiCallback<T = void> = (value: T) => void | Promise<void>;
export interface PluginWidgetOptions { signal: AbortSignal }
export interface PluginWidgetHandle<Props> {
	update(props: Partial<Props>): void;
	dispose(): void;
}
export interface PluginModelValue { provider: string; id: string }
export interface PluginModelPickerProps {
	value: PluginModelValue | undefined;
	onChange: PluginUiCallback<PluginModelValue>;
	disabled?: boolean;
}
export interface PluginKnowledgePickerProps {
	value: readonly string[];
	onChange: PluginUiCallback<readonly string[]>;
	disabled?: boolean;
}
export interface PluginThinkingPickerProps {
	model: PluginModelValue | undefined;
	value: ThinkingLevel | undefined;
	onChange: PluginUiCallback<ThinkingLevel>;
	disabled?: boolean;
}
export interface PluginComposerProps {
	value: string;
	onChange: PluginUiCallback<string>;
	onSend: () => void | Promise<void>;
	busy?: boolean;
	onStop?: () => void | Promise<void>;
	canSend?: boolean;
	placeholder?: string;
	autoFocus?: boolean;
}
export interface PluginDictationProps {
	disabled?: boolean;
	onTranscript: PluginUiCallback<string>;
}
export interface PluginDictationHandle extends PluginWidgetHandle<PluginDictationProps> {
	toggle(): void;
	finish(): Promise<void>;
	cancel(): void;
}
export interface PluginStandardComposerProps {
	composer: PluginComposerProps;
	model: PluginModelPickerProps;
	thinking: PluginThinkingPickerProps;
	dictation: PluginDictationProps;
}
export interface PluginButtonColorState {
	background?: string;
	text?: string;
	border?: string;
}
export interface PluginButtonColors extends PluginButtonColorState {
	hover?: PluginButtonColorState;
	active?: PluginButtonColorState;
	focusVisible?: PluginButtonColorState & { ring?: string };
	disabled?: PluginButtonColorState;
}
export interface PluginButtonProps {
	label: string;
	icon?: string;
	iconOnly?: boolean;
	onClick: () => void | Promise<void>;
	disabled?: boolean;
	variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link" | "custom";
	colors?: PluginButtonColors;
	size?: "default" | "xs" | "sm" | "lg" | "icon" | "icon-xs" | "icon-sm" | "icon-lg";
	title?: string;
}
export interface PluginBadgeProps {
	text: string;
	color?: string;
}
export type PluginUiContent = HTMLElement | ((container: HTMLElement, signal: AbortSignal) => void | (() => void) | Promise<void | (() => void)>);
export interface PluginMarkdownProps { text: string }
export interface PluginWorkerResultProps {
	label: string;
	status: "succeeded" | "failed" | "cancelled" | "interrupted";
	text: string;
	content?: PluginUiContent;
	presentation?: "collapsed" | "card" | "plain";
}
declare const pluginSurfaceTargetBrand: unique symbol;
export interface PluginSurfaceTarget { readonly [pluginSurfaceTargetBrand]: true }
export interface PluginSurfaceProps {
	title: string;
	background?: "dimmed" | "opaque";
	content: PluginUiContent;
	onClose?: () => void | Promise<void>;
}
export interface PluginDialogProps {
	title: string;
	content: PluginUiContent;
	onClose?: () => void | Promise<void>;
}
export interface PluginMenuItem {
	key: string;
	label: string;
	disabled?: boolean;
	onSelect: () => void | Promise<void>;
}
export interface PluginMenuProps {
	items: PluginMenuItem[];
	label?: string;
	preferredSide?: "up" | "down";
	onClose?: () => void | Promise<void>;
}
interface PluginSettingsRowBase<T> {
	key: string;
	label: string;
	description?: string;
	value: T;
	onChange: PluginUiCallback<T>;
	validate?: (value: T) => string | undefined;
	disabled?: boolean;
}
export type PluginSettingsRow =
	| (PluginSettingsRowBase<boolean> & { type: "toggle" })
	| (PluginSettingsRowBase<string> & { type: "text" })
	| (PluginSettingsRowBase<string> & { type: "dropdown"; options: { value: string; label: string }[] })
	| (PluginSettingsRowBase<number> & { type: "number" | "slider"; min?: number; max?: number; step?: number });
export interface PluginSettingsSchema { rows: PluginSettingsRow[] }
export interface PluginUi {
	mountModelPicker(container: HTMLElement, props: PluginModelPickerProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginModelPickerProps>;
	mountThinkingPicker(container: HTMLElement, props: PluginThinkingPickerProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginThinkingPickerProps>;
	mountKnowledgePicker(container: HTMLElement, props: PluginKnowledgePickerProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginKnowledgePickerProps>;
	mountComposer(container: HTMLElement, props: PluginComposerProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginComposerProps>;
	mountDictation(container: HTMLElement, props: PluginDictationProps, options: PluginWidgetOptions): PluginDictationHandle;
	mountStandardComposer(container: HTMLElement, props: PluginStandardComposerProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginStandardComposerProps>;
	mountButton(container: HTMLElement, props: PluginButtonProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginButtonProps>;
	mountBadge(container: HTMLElement, props: PluginBadgeProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginBadgeProps>;
	mountSettingsRows(container: HTMLElement, props: PluginSettingsSchema, options: PluginWidgetOptions): PluginWidgetHandle<PluginSettingsSchema>;
	mountMarkdown(container: HTMLElement, props: PluginMarkdownProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginMarkdownProps>;
	mountTree(container: HTMLElement, tree: PluginTreeProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginTreeProps>;
	mountWorkerResult(container: HTMLElement, props: PluginWorkerResultProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginWorkerResultProps>;
	openMenu(anchor: HTMLElement, props: PluginMenuProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginMenuProps>;
	openDialog(props: PluginDialogProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginDialogProps>;
	openSurface(props: PluginSurfaceProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginSurfaceProps>;
	openSurface(target: PluginSurfaceTarget, props: PluginSurfaceProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginSurfaceProps>;
}
