"use client";

import { useAttachmentUploads } from "@/components/file-path-drop-zone";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { SurfaceRegion, usePageSurfaceBoundary, useSurfaceChromeStyle } from "./plugin-surfaces";
import { ArrowUpIcon } from "@/components/ui/icons";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MinimalHome } from "@/components/minimal-home";
import { SetupDialog } from "@/components/setup-dialog";
import { ComposerActions, NodePickerControl } from "@/components/composer-actions";
import { useModelSetup, selectedModelUnavailable, openModelPicker, ZeroKeysPill } from "@/components/setup-cta";
import { DictationBar, joinDictation, useDictation } from "@/components/dictation";
import { useFieldCycle } from "@/components/field-cycle";
import { useOptionalInteractionLayers } from "./interaction-layers";
import { isInteractionScopeEligible } from "./plugin-input-focus";
import { SidebarToggle } from "@/components/sidebar";
import { SessionModeCards } from "@/components/session-mode-cards";
import { StatsBar } from "@/components/stats-bar";
import { OPENING_PROMPT_FAILURE } from "@/components/opening-prompt";
import { PathInput } from "@/components/path-input";
import { AttachFilesButton } from "@/components/attach-files-button";
import { SessionStarter } from "@/components/start-session";
import type { TurnUsage } from "@/src/core";

export function Home({
	initialConfigured,
}: {
	initialConfigured: boolean;
}) {
	const attachments = useAttachmentUploads();
	const controller = useOptionalInteractionLayers();
	const router = useRouter();
	const pathname = usePathname();
	const bodyRef = useRef<HTMLDivElement>(null);
	const surfaceTarget = usePageSurfaceBoundary({ active: pathname === "/", viewKey: "/", bodyRef });
	const chromeStyle = useSurfaceChromeStyle(surfaceTarget);
	const [topic, setTopic] = useState("");
	const topicRef = useRef("");
	const { catalog, configured, zeroKeys } = useModelSetup(initialConfigured);
	const [setupOpen, setSetupOpen] = useState(false);
	const dictation = useDictation({
		append: (t) => {
			const v = joinDictation(topicRef.current, t);
			topicRef.current = v;
			setTopic(v);
		},
	});
	const [busy, setBusy] = useState(false);
	const startingRef = useRef(false);
	const starterRef = useRef(new SessionStarter());
	const [startError, setStartError] = useState(false);
	const topicInputRef = useRef<HTMLDivElement>(null);
	const cycleTopicField = useCallback(
		(): readonly HTMLElement[] => (topicInputRef.current ? [topicInputRef.current] : []),
		[],
	);
	useFieldCycle(cycleTopicField);
	const dictationWasActiveRef = useRef(false);
	useEffect(() => {
		if (dictation.active) {
			dictationWasActiveRef.current = true;
		} else if (dictationWasActiveRef.current) {
			dictationWasActiveRef.current = false;
			if (isInteractionScopeEligible(topicInputRef.current, controller)) topicInputRef.current!.focus();
		}
	}, [dictation.active, controller]);

	const [mode, setMode] = useState<"teach" | "practice">("teach");
	const [practiceProps, setPracticeProps] = useState<{ id: string; name: string; statement: string }[]>([]);
	const [chainSelectOpen, setChainSelectOpen] = useState(false);
	const pickedIds = useMemo(() => new Set(practiceProps.map((p) => p.id)), [practiceProps]);

	const start = () => {
		if (attachments.isUploading()) return;
		if (!dictation.active) {
			void begin();
			return;
		}
		void dictation.finish().then(() => begin());
	};
	const begin = async () => {
		if (attachments.isUploading()) return;
		const t = topicRef.current.trim();
		if (!t || startingRef.current) return;
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
		try {
			const target = await starterRef.current.start({
				title: t,
				...(mode === "practice" ? { kind: "practice" } : {}),
				...(practiceProps.length > 0 ? { graphContext: { propositions: practiceProps } } : {}),
			}, fetch, JSON.stringify(catalog?.slots.strong));
			router.push(target);
		} catch {
			startingRef.current = false;
			setBusy(false);
			setStartError(true);
		}
	};

	return (
		<div className="relative h-dvh">

			{
}
			<div ref={bodyRef} className="absolute inset-0">
			<main className="absolute inset-0">
					<MinimalHome
						showGraphControls={false}
						chainSelectOpen={chainSelectOpen}
						practiceSelection={pickedIds}
						onPracticeSelectionChange={setPracticeProps}
						onChainSelectClose={() => setChainSelectOpen(false)}
					/>
			</main>


			{
}
			<div className="pointer-events-none absolute inset-x-0 bottom-0 pb-5">
				<div className="pointer-events-auto mx-auto w-full max-w-[46rem] px-4">
					{
}
					<ComposerActions
						picker={(practiceProps.length > 0 || mode === "practice") && (
							<NodePickerControl
								count={practiceProps.length}
								onOpen={() => setChainSelectOpen(true)}
								onClear={() => setPracticeProps([])}
							/>
						)}
						setup={zeroKeys ? (
							<ZeroKeysPill inline onOpen={() => setSetupOpen(true)} />
						) : (
							!configured && (
								<button
									type="button"
									data-testid="setup-cta"
									onClick={() => setSetupOpen(true)}
									className={buttonVariants({ variant: "secondary", size: "sm" })}
								>
									Set up your models
								</button>
							)
						)}
					/>
					{startError && <p role="alert" className="mb-2 rounded-xl bg-error-soft px-3 py-2 text-sm font-bold text-error">{OPENING_PROMPT_FAILURE}</p>}
					<SessionModeCards mode={mode} onChange={setMode} disabled={busy} />
					<div className="overflow-hidden rounded-3xl border-2 bg-card shadow-[0_4px_0_var(--border)] focus-within:border-secondary">

					<form
						data-attachment-composer=""
						className="flex items-end gap-2 p-2"
					onSubmit={(e) => {
						e.preventDefault();
						void start();
					}}
				>
					<PathInput
						ref={topicInputRef}
						value={topic}
						onValueChange={(value) => {
							topicRef.current = value;
							setTopic(value);
						}}
						defaultDropTarget
						onKeyDown={(e) => {
							if (!isInteractionScopeEligible(e.currentTarget, controller)) return;
							if (e.key === "Escape" && dictation.active) {
								controller?.claimEscape(e);
								e.preventDefault();
								e.stopPropagation();
								dictation.cancel();
								return;
							}
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								void start();
							}
						}}
						placeholder={mode === "practice" ? "What would you like to challenge yourself with?" : "What do you want to learn?"}
						autoFocus
						className="field-sizing-content ow-input max-h-48 min-h-11 flex-1 resize-none bg-transparent px-3 py-2.5 font-semibold outline-none placeholder:font-medium placeholder:text-muted-foreground"
					/>
					<AttachFilesButton editorRef={topicInputRef} />
					<DictationBar dictation={dictation} iconOnly />
					{
}
					<button
						type="submit"
						aria-label="Start session"
						disabled={attachments.uploading || (!topic.trim() && !dictation.active) || busy}
						className={cn(buttonVariants({ size: "icon-lg" }), "size-11 rounded-2xl")}
					>
						<ArrowUpIcon className="size-5" strokeWidth={3} />
					</button>
					</form>
					</div>
					{
}
					<StatsBar turns={[] as TurnUsage[]} />
				</div>
			</div>

			<SurfaceRegion target={surfaceTarget} />
			</div>
			{
}
			<header style={chromeStyle} className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2 px-3 py-2">
				<div className="pointer-events-auto">
					<SidebarToggle />
				</div>
			</header>

			{
}
			<SetupDialog
				open={setupOpen}
				onClose={() => setSetupOpen(false)}
				onDone={() => {
					setSetupOpen(false);
				}}
				/>
		</div>
	);
}
