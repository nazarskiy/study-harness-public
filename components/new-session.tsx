"use client";

import { useAttachmentUploads } from "@/components/file-path-drop-zone";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { SurfaceRegion, usePageSurfaceBoundary, useSurfaceChromeStyle } from "./plugin-surfaces";
import { Conversation, ConversationContent, ConversationEmptyState } from "@/components/ai-elements/conversation";
import { Composer } from "@/components/composer";
import { DictationBar, joinDictation, useDictation } from "@/components/dictation";
import { useFieldCycle } from "@/components/field-cycle";
import { useOptionalInteractionLayers } from "./interaction-layers";
import { isInteractionScopeEligible } from "./plugin-input-focus";
import { SidebarToggle } from "@/components/sidebar";
import { SetupDialog } from "@/components/setup-dialog";
import { useModelSetup, selectedModelUnavailable, openModelPicker, ZeroKeysPill } from "@/components/setup-cta";
import { SessionModeCards } from "@/components/session-mode-cards";
import { StatsBar } from "@/components/stats-bar";
import { ChainTableOverlay } from "@/components/chain-table.tsx";
import { ComposerActions, NodePickerControl } from "@/components/composer-actions";
import { OPENING_PROMPT_FAILURE } from "@/components/opening-prompt";
import { SessionStarter } from "@/components/start-session";
import type { ChatSettings, GraphSnapshot } from "@/src/core";

export type DraftPick = { id: string; name: string; statement: string };


const DOCK = "mx-auto w-full max-w-[46rem] px-4";

export async function startDraftSession(
	text: string,
	fetchLike: typeof fetch,
	mode?: "practice",
	picks?: readonly DraftPick[],
	starter = new SessionStarter(),
	settingsIdentity?: string,
): Promise<string | null> {
	const t = text.trim();
	if (!t) return null;
	return starter.start(
		mode === "practice"
			? { title: t, kind: "practice", ...(picks && picks.length > 0 ? { graphContext: { propositions: picks } } : {}) }
			: { title: t },
		fetchLike,
		settingsIdentity,
	);
}

export function DraftShell({
	busy,
	text,
	onChange,
	onSend,
	startError = false,
	setupCta,
	mode = "teach",
	picks = [],
	onOpenPicker,
	onClearPicks,
	overlay,
}: {
	busy: boolean;
	text: string;
	onChange: (v: string) => void;
	onSend: () => void;
	startError?: boolean;
	mode?: "teach" | "practice";
	setupCta?: ReactNode;
	picks?: DraftPick[];
	onOpenPicker?: () => void;
	onClearPicks?: () => void;
	overlay?: ReactNode;
}) {
	const controller = useOptionalInteractionLayers();
	const pathname = usePathname();
	const router = useRouter();
	const bodyRef = useRef<HTMLDivElement>(null);
	const surfaceTarget = usePageSurfaceBoundary({ active: pathname === "/chat/new", viewKey: "/chat/new", bodyRef });
	const chromeStyle = useSurfaceChromeStyle(surfaceTarget);
	const cycleComposer = useCallback((): readonly HTMLElement[] =>
		Array.from(document.querySelectorAll<HTMLElement>('[data-testid="composer"] [data-file-path-input]')),
		[]);
	useFieldCycle(cycleComposer);
	const dictation = useDictation({
		append: (t) => onChange(joinDictation(text, t)),
	});
	const attachments = useAttachmentUploads();
	const canSend = !attachments.uploading && (text.trim().length > 0 || dictation.active);
	const handleSend = () => {
		if (attachments.isUploading()) return;
		if (dictation.active) {
			void dictation.finish().then(() => { if (!attachments.isUploading()) onSend(); });
			return;
		}
		onSend();
	};
	const composerInputRef = useRef<HTMLDivElement>(null);
	const dictationWasActiveRef = useRef(false);
	useEffect(() => {
		if (dictation.active) {
			dictationWasActiveRef.current = true;
		} else if (dictationWasActiveRef.current) {
			dictationWasActiveRef.current = false;
			if (isInteractionScopeEligible(composerInputRef.current, controller)) composerInputRef.current!.focus();
		}
	}, [dictation.active, controller]);
	return (
		<div className="relative flex h-dvh">
			<div className="flex min-w-0 flex-1 flex-col">
				<div ref={bodyRef} className="relative flex min-h-0 flex-1">
					{
}
					<div className="pointer-events-none sticky bottom-0 mt-auto w-full">
						<Conversation className="h-full min-w-0 flex-1" initial="instant">
							<ConversationContent className="min-h-full gap-0 p-0">
								<ConversationEmptyState
									title={mode === "practice" ? "New challenge" : "Start learning"}
									description={
										mode === "practice"
											? "Pick nodes from your knowledge map, choose what you want to challenge yourself with, or bring your own problem."
											: "Explore a topic with Owlly, starting with what you already know."
									}
								/>
							</ConversationContent>
						</Conversation>
						<div className="h-24 bg-gradient-to-t from-background via-background/85 to-transparent" />
						<div className="bg-background pb-4">
							<div className={DOCK}>
								<ComposerActions
									picker={(picks.length > 0 || mode === "practice") && (
										<NodePickerControl count={picks.length} onOpen={onOpenPicker} onClear={onClearPicks} />
									)}
									setup={setupCta}
								/>
								{startError && <p role="alert" className="pointer-events-auto mb-2 text-sm text-destructive">{OPENING_PROMPT_FAILURE}</p>}
								<SessionModeCards mode={mode} disabled={busy} onChange={(next) => router.push(next === "practice" ? "/chat/new?mode=practice" : "/chat/new")} />
								<div data-attachment-composer="" className="pointer-events-auto overflow-hidden rounded-2xl border-2 bg-card shadow-lg">

									<Composer
										dictationSlot={<DictationBar dictation={dictation} iconOnly />}
										busy={busy}
										value={text}
										onChange={onChange}
										onSend={handleSend}
										onStop={() => {}}
										canSend={canSend}
										inputRef={composerInputRef}
										autoFocus
										onEscape={dictation.active ? dictation.cancel : undefined}
										placeholder={mode === "practice" ? "What would you like to challenge yourself with?" : "What do you want to learn?"}
									/>
								</div>
								<StatsBar
									turns={[]}
								/>
							</div>
						</div>
					</div>
					<SurfaceRegion target={surfaceTarget}>
						<div className="contents pointer-events-auto">{overlay}</div>
					</SurfaceRegion>
				</div>
			</div>
			{
}
			<header style={chromeStyle} className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2 px-3 py-2">
				<div className="pointer-events-auto">
					<SidebarToggle />
				</div>
			</header>
		</div>
	);
}

export function NewSession({ initialConfigured, mode = "teach" }: { initialConfigured: boolean; mode?: "teach" | "practice" }) {
	const router = useRouter();
	const [text, setText] = useState("");
	const textRef = useRef("");
	const applyText = (v: string) => {
		textRef.current = v;
		setText(v);
	};
	const [busy, setBusy] = useState(false);
	const startingRef = useRef(false);
	const starterRef = useRef(new SessionStarter());
	const [startError, setStartError] = useState(false);
	const [picks, setPicks] = useState<DraftPick[]>([]);
	const picksRef = useRef<DraftPick[]>([]);
	const applyPicks = (next: DraftPick[]) => {
		picksRef.current = next;
		setPicks(next);
	};
	const [pickerOpen, setPickerOpen] = useState(false);
	const [snapshot, setSnapshot] = useState<GraphSnapshot | null>(null);
	const openPicker = () => {
		if (snapshot) {
			setPickerOpen(true);
			return;
		}
		void fetch("/api/graph")
			.then((r) => r.json() as Promise<GraphSnapshot>)
			.then((snap) => {
				setSnapshot(snap);
				setPickerOpen(true);
			})
			.catch(() => {
			});
	};

	const { catalog, configured, zeroKeys } = useModelSetup(initialConfigured);
	const [setupOpen, setSetupOpen] = useState(false);

	const send = useCallback(() => {
		const draft = textRef.current.trim();
		if (!draft || startingRef.current) return;
		if (!configured) {
			setSetupOpen(true);
			return;
		}
		if (zeroKeys) {
			setSetupOpen(true);
			return;
		}
		const strong = catalog?.slots.strong?.model;
		if (selectedModelUnavailable(catalog, strong ? `${strong.provider}:${strong.id}` : undefined)) {
			openModelPicker();
			return;
		}
		startingRef.current = true;
		setBusy(true);
		setStartError(false);
		void startDraftSession(draft, fetch, mode === "practice" ? "practice" : undefined, mode === "practice" ? picksRef.current : undefined,
			starterRef.current, JSON.stringify(catalog?.slots.strong))
			.then((target) => {
				if (target) router.push(target);
				else { startingRef.current = false; setBusy(false); }
			})
			.catch(() => {
				startingRef.current = false;
				setBusy(false);
				setStartError(true);
			});
	}, [router, configured, zeroKeys, catalog, mode]);

	return (
		<>
			<DraftShell
				busy={busy}
				startError={startError}
				text={text}
				onChange={applyText}
				onSend={send}
				mode={mode}
				picks={picks}
				onOpenPicker={openPicker}
				onClearPicks={() => applyPicks([])}
				overlay={
					<ChainTableOverlay
						open={pickerOpen}
						nodes={snapshot?.propositions ?? []}
						chains={snapshot?.chains ?? []}
						sessions={snapshot?.sessions ?? {}}
						fileSources={snapshot?.fileSources ?? {}}
						onClose={() => setPickerOpen(false)}
						selectMode
						controlledSelection={new Set(picks.map((p) => p.id))}
						onSelectionChange={(ids) => {
							const byId = new Map((snapshot?.propositions ?? []).map((n) => [n.id, n]));
							const next: DraftPick[] = [];
							for (const id of ids) {
								const n = byId.get(id);
								if (n) next.push({ id: n.id, name: n.name, statement: n.statement });
							}
							applyPicks(next);
						}}
					/>
				}
				setupCta={
					zeroKeys ? (
						<ZeroKeysPill inline onOpen={() => setSetupOpen(true)} />
					) : (
						!configured && (
							<button
								type="button"
								data-testid="setup-cta"
								onClick={() => setSetupOpen(true)}
								className="rounded-lg border-2 border-border bg-card px-3 py-1.5 text-xs text-foreground transition-colors hover:border-muted-foreground/50 hover:bg-accent cursor-pointer"
							>
								Set up your models
							</button>
						)
					)
				}
			/>
			{
}
			<SetupDialog
				open={setupOpen}
				onClose={() => setSetupOpen(false)}
				onDone={() => {
					setSetupOpen(false);
				}}
				/>
		</>
	);
}