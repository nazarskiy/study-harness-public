"use client";

import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useId,
	useRef,
	useState,
	type ReactElement,
	type ReactNode,
	type RefObject,
} from "react";
import { BotIcon, KeyIcon, PaletteIcon, WaypointsIcon, type AppIcon, XIcon } from "@/components/ui/icons";
import { HostDialog } from "@/components/host-dialog";
import { useInteractionLayers, type CloseOutcome } from "@/components/interaction-layers";
import {
	CURRENT_SETTINGS_VERSION,
	type AgentSettings,
	type AppearanceSettings,
	type CompactionSettings,
	type GraphSettings,
	type UserSettings,
} from "@/src/core";
import { useAppearance } from "./appearance.tsx";
import { Owl } from "@/components/owl/owl";
import { SettingsSection } from "./controls.tsx";
import { AgentSection } from "./agent-section.tsx";
import type { ModelsSettings } from "@/src/core";
import { MENU_CLOSE_EVENT, MENU_OPEN_EVENT } from "@/components/menu-shell";
import { notifySettingsSaved } from "@/components/settings-signal";
import { KeysSection } from "./keys-section.tsx";
import { Hint } from "@/components/ui/hint";
import { AppearanceSection, GraphSection } from "./appearance-section.tsx";
import { PluginSettingsPage } from "./plugin-settings-page.tsx";
import { usePlugins } from "@/components/plugins";
import { ChatGPTUIProvider } from "./chatgpt-connection.tsx";
import { NativeSubscriptionUIProvider } from "./subscription-connections.tsx";

const SECTIONS = [
	{ id: "keys", label: "Providers", icon: KeyIcon },
	{ id: "agent", label: "Agent", icon: BotIcon },
	{ id: "appearance", label: "Appearance", icon: PaletteIcon },
	{ id: "graph", label: "Knowledge map", icon: WaypointsIcon },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"] | `plugin:${string}`;

const DialogContext = createContext<{ open: (section?: string, row?: string) => void }>({ open: () => {} });
interface SettingsWriteOrder {
	issued: number;
	acknowledged: number;
	record?: UserSettings;
	fileAccessError?: string | null;
	listeners: Set<(record: UserSettings, fileAccessError: string | null) => void>;
}
const WriteOrderContext = createContext<RefObject<SettingsWriteOrder> | null>(null);

export function SettingsDialogProvider({
	children,
}: {
	children: React.ReactNode;
}) {
	const interactions = useInteractionLayers();
	const layerId = useId();
	const writeOrder = useRef<SettingsWriteOrder>({ issued: 0, acknowledged: 0, listeners: new Set() });
	const [show, setShow] = useState(false);
	const [landOn, setLandOn] = useState<SectionId>("keys");
	const [landOnRow, setLandOnRow] = useState<string | null>(null);
	const [navigationRequest, setNavigationRequest] = useState(0);
	const open = useCallback((section?: string, row?: string) => {
		if (interactions.getLayer(layerId) && interactions.popTo(layerId) !== "closed") return;
		interactions.invalidateOpening();
		setNavigationRequest(request => request + 1);
		setLandOn(section && (SECTIONS.some(item => item.id === section) || section.startsWith("plugin:")) ? section as SectionId : "keys");
		setLandOnRow(row ?? null);
		setShow(true);
	}, [interactions, layerId]);
	const close = useCallback((): CloseOutcome => { setShow(false); return "closed"; }, []);
	useEffect(() => {
		const onPluginSettings = (event: Event) => {
			const pluginId: unknown = (event as CustomEvent<unknown>).detail;
			if (typeof pluginId === "string") open(`plugin:${pluginId}`);
		};
		window.addEventListener("owlly:open-plugin-settings", onPluginSettings);
		return () => window.removeEventListener("owlly:open-plugin-settings", onPluginSettings);
	}, [open]);
	return (
		<ChatGPTUIProvider><NativeSubscriptionUIProvider><WriteOrderContext.Provider value={writeOrder}><DialogContext.Provider value={{ open }}>
			{children}
			{show && (
				<SettingsDialog onClose={close} initialSection={landOn} initialRow={landOnRow} navigationRequest={navigationRequest} layerId={layerId} />
			)}
		</DialogContext.Provider></WriteOrderContext.Provider></NativeSubscriptionUIProvider></ChatGPTUIProvider>
	);
}

export function useSettingsDialog() {
	return useContext(DialogContext);
}

function SettingsDialog({
	onClose,
	initialSection,
	initialRow,
	navigationRequest,
	layerId,
}: {
	onClose: () => CloseOutcome;
	initialSection: SectionId;
	navigationRequest: number;
	layerId: string;
	initialRow: string | null;
}) {
	return <SettingsDialogBody onClose={onClose} initialSection={initialSection}
		initialRow={initialRow} navigationRequest={navigationRequest}
		renderFrame={frame => <HostDialog open layerId={layerId} ownerId={null}
			onClose={onClose} frame={frame} aria-label="Settings"
			backdropProps={{
				className: "fixed inset-0 z-50 flex items-center justify-center bg-black/45",
				"data-testid": "settings-backdrop",
			}}>{frame.props.children}</HostDialog>} />;
}

export function SettingsDialogBody({
	onClose,
	initialSection = "keys",
	initialRow = null,
	navigationRequest = 0,
	renderFrame,
}: {
	onClose: () => void;
	renderFrame?: (frame: ReactElement<{ children: ReactNode }>) => ReactNode;
	initialSection?: SectionId;
	navigationRequest?: number;
	initialRow?: string | null;
}) {
	const { onAppearanceChange } = useAppearance();
	const inheritedWriteOrder = useContext(WriteOrderContext);
	const standaloneWriteOrder = useRef<SettingsWriteOrder>({ issued: 0, acknowledged: 0, listeners: new Set() });
	const writeOrder = inheritedWriteOrder ?? standaloneWriteOrder;
	const { snapshot } = usePlugins();
	const [record, setRecord] = useState<UserSettings | null | undefined>(
		undefined,
	);
	const [error, setError] = useState<string | null>(null);
	const [fileAccessError, setFileAccessError] = useState<string | null>(null);
	const [openMenus, setOpenMenus] = useState(0);
	const contentRef = useRef<HTMLDivElement | null>(null);
	useEffect(() => {
		const el = contentRef.current;
		if (!el || openMenus === 0) return;
		const block = (e: Event) => e.preventDefault();
		el.addEventListener("wheel", block, { passive: false });
		el.addEventListener("touchmove", block, { passive: false });
		return () => {
			el.removeEventListener("wheel", block);
			el.removeEventListener("touchmove", block);
		};
	}, [openMenus]);

	useEffect(() => {
		const onOpen = () => setOpenMenus((n) => n + 1);
		const onClose = () => setOpenMenus((n) => Math.max(0, n - 1));
		window.addEventListener(MENU_OPEN_EVENT, onOpen);
		window.addEventListener(MENU_CLOSE_EVENT, onClose);
		return () => {
			window.removeEventListener(MENU_OPEN_EVENT, onOpen);
			window.removeEventListener(MENU_CLOSE_EVENT, onClose);
		};
	}, []);
	const [active, setActive] = useState<SectionId>(initialSection);
	useEffect(() => {
		setActive(initialSection);
	}, [initialSection, navigationRequest]);

	const enabledPlugins = snapshot.plugins.filter(plugin => plugin.info.enabled);
	const activePluginId = active.startsWith("plugin:") ? active.slice("plugin:".length) : null;
	const activePlugin = enabledPlugins.find(plugin => plugin.info.id === activePluginId);
	const missingPlugin = activePluginId !== null && !activePlugin && !snapshot.loading;
	useEffect(() => {
		if (missingPlugin) setActive("keys");
	}, [missingPlugin]);
	const selected = missingPlugin ? "keys" : active;
	const navSections: { id: SectionId; label: string; icon?: AppIcon }[] = [
		...SECTIONS,
		...enabledPlugins.map(plugin => ({ id: `plugin:${plugin.info.id}` as const, label: plugin.info.manifest?.name ?? plugin.info.id })),
	];

	useEffect(() => {
		const authority = writeOrder.current;
		const apply = (record: UserSettings, fileAccessError: string | null) => {
			setRecord(record);
			setFileAccessError(fileAccessError);
		};
		authority.listeners.add(apply);
		return () => { authority.listeners.delete(apply); };
	}, [writeOrder]);

	useEffect(() => {
		const authority = writeOrder.current;
		const acknowledgedAtRead = authority.acknowledged;
		let alive = true;
		const applyLoaded = (loaded: UserSettings | null, fileAccessError: string | null = null) => {
			if (!alive) return;
			const unchanged = authority.acknowledged === acknowledgedAtRead;
			setRecord(unchanged ? loaded : authority.record ?? loaded);
			setFileAccessError(unchanged ? fileAccessError : authority.fileAccessError ?? null);
		};
		fetch("/api/settings")
			.then((r) =>
				r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`)),
			)
			.then((body: { settings: UserSettings | null; fileAccessError?: string }) =>
				applyLoaded(body.settings ?? { version: CURRENT_SETTINGS_VERSION }, body.fileAccessError ?? null),
			)
			.catch(() => applyLoaded(null));
		return () => { alive = false; };
	}, [writeOrder]);

	const write = useCallback(
		async (
			section: "general" | "agent" | "models" | "appearance" | "graph" | "compaction",
			body: object,
		): Promise<boolean> => {
			const ticket = ++writeOrder.current.issued;
			setError(null);
			try {
				const res = await fetch(`/api/settings/${section}`, {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(body),
				});
				if (!res.ok) {
					const detail = (await res.json().catch(() => ({}))) as {
						error?: string;
					};
					if (ticket === writeOrder.current.issued) setError(`${section}: ${detail.error ?? res.status}`);
					return false;
				}
				const reply = (await res.json().catch(() => null)) as { settings?: UserSettings; fileAccessError?: string } | null;
				const stored = reply?.settings;
				if (!stored || typeof stored !== "object" || Array.isArray(stored) || stored.version !== 1 ||
					!stored[section] || typeof stored[section] !== "object" || Array.isArray(stored[section])) {
					if (ticket === writeOrder.current.issued) setError(`${section}: Could not confirm saved settings. Your input has been kept.`);
					return false;
				}
				if (ticket >= writeOrder.current.acknowledged) {
					writeOrder.current.acknowledged = ticket;
					writeOrder.current.record = stored;
					writeOrder.current.fileAccessError = reply?.fileAccessError ?? null;
					for (const apply of writeOrder.current.listeners) apply(stored, writeOrder.current.fileAccessError);
					onAppearanceChange(stored.appearance);
				}
				notifySettingsSaved(section);
				return true;
			} catch (error) {
				if (ticket === writeOrder.current.issued) setError(`${section}: ${error instanceof Error ? error.message : String(error)}`);
				return false;
			}
		},
		[onAppearanceChange, writeOrder],
	);

	const frame = (
		<div
			tabIndex={-1}
			role="dialog"
			aria-modal="true"
			aria-label="Settings"
			data-testid="settings-dialog"
			className="settings-dialog-pop flex h-[660px] max-h-[88vh] w-[960px] max-w-[92vw] flex-col overflow-hidden rounded-3xl border-2 border-border bg-background shadow-2xl"
			onClick={(e) => e.stopPropagation()}
		>
			<header className="flex h-18 shrink-0 items-center gap-3 border-b-2 border-border bg-card px-5">
				<Owl mood="neutral" size={44} />
				<h2 className="text-2xl font-black tracking-tight">Settings</h2>
				<Hint
						label="Close"
						binding="escape"
						side="left"
					>
						<button
					type="button"
					aria-label="Close settings"
					data-testid="settings-close"
					className="ml-auto flex size-10 cursor-pointer items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
					onClick={onClose}
				>
					<XIcon className="size-5" strokeWidth={2.75} />
				</button>
					</Hint>
			</header>

			<div className="flex min-h-0 flex-1">
				{
}
				<nav
					aria-label="Settings sections"
					data-testid="settings-nav"
					className="flex min-h-0 w-56 shrink-0 flex-col gap-1 overflow-y-auto border-r-2 border-border bg-card p-3"
				>
					{navSections.map((s, index) => (
						<div key={s.id} className="shrink-0">
							{index === SECTIONS.length && <hr className="my-2 border-t-2 border-border" />}
							<button
								type="button"
								data-testid={`settings-nav-${s.id}`}
								aria-current={selected === s.id}
								className={`flex w-full cursor-pointer items-center gap-3 break-words rounded-xl border-2 px-3 py-2 text-left text-sm font-extrabold transition-colors ${
									selected === s.id
										? "border-secondary/70 bg-secondary-soft text-secondary"
										: "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
								}`}
								onClick={() => setActive(s.id)}
							>
								{s.icon && <s.icon aria-hidden="true" focusable="false" className="size-5 shrink-0" />}
								<span className="min-w-0">{s.label}</span>
							</button>
						</div>
					))}
				</nav>

				{
}
				<div
					ref={contentRef}
					className="min-w-0 flex-1 overflow-y-auto"
					data-testid="settings-content"
				>
					{error && !activePluginId && (
						<p
							role="alert"
							className="m-4 rounded-xl border-2 border-error/40 bg-error-soft px-3 py-2 text-sm font-bold text-error"
							data-testid="settings-error"
						>
							{error}
						</p>
					)}
					{activePlugin ? <PluginSettingsPage key={`${activePlugin.info.id}/${activePlugin.info.revision}`} plugin={activePlugin} />
							: activePluginId !== null ? <p role="status" className="px-6 py-5 text-xs text-muted-foreground">Loading plugins…</p>
								: record === undefined ? (
						<p className="px-6 py-5 text-xs text-muted-foreground/70">
							Loading settings…
						</p>
					) : record === null ? (
						<p className="px-6 py-5 text-xs text-muted-foreground/70">
							Settings could not be loaded — refresh to retry.
						</p>
					) : (
						<div>
							{active === "keys" && (
								<SettingsSection title="Providers" testid="section-keys">
									<KeysSection initialRow={initialRow ?? undefined} />
								</SettingsSection>
							)}
							{active === "agent" && (
								<SettingsSection
									title="Agent"
									testid="section-agent"
								>
									<AgentSection
										agent={record.agent}
										fileAccessError={fileAccessError}
										models={record.models}
										graph={record.graph}
										compaction={record.compaction}
										onModelsChange={(next: ModelsSettings) =>
											void write("models", next)
										}
										onSectionChange={(next: AgentSettings) =>
											write("agent", next)
										}
										onCompactionChange={(next: CompactionSettings) =>
											write("compaction", next)
										}
									/>
								</SettingsSection>
							)}
							{active === "appearance" && (
								<SettingsSection
									title="Appearance"
									testid="section-appearance"
								>
									<AppearanceSection
										appearance={record.appearance}
										onSectionChange={(next: AppearanceSettings) =>
											write("appearance", next)
										}
									/>
								</SettingsSection>
							)}
							{active === "graph" && (
								<SettingsSection
									title="Knowledge map"
									testid="section-graph"
								>
									<GraphSection
										graph={record.graph}
										onSectionChange={(next: GraphSettings) =>
											write("graph", next)
										}
									/>
								</SettingsSection>
							)}
						</div>
					)}
				</div>
			</div>
		</div>
	);
	return renderFrame ? renderFrame(frame) : frame;
}
