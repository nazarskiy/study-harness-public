"use client";

import { useCallback, useEffect, useState } from "react";
import { ListTreeIcon } from "@/components/ui/icons";
import { ChainTableOverlay } from "@/components/chain-table.tsx";
import { GraphCostControl } from "@/components/graph-view.tsx";
import { NotesImportControl, NotesImportErrors, NotesImportNotices, useNotesImport } from "@/components/notes-import.tsx";
import { Hint } from "@/components/ui/hint";
import { OwlHero } from "@/components/owl/owl-hero";
import type { ChatSummary, GraphCostSummary, GraphSnapshot } from "@/src/core";

export function KnowledgeSummary({
	propositions,
	chains,
	teachSessions,
	practiceSessions,
	importedNotes,
}: {
	propositions: number;
	chains: number;
	teachSessions: number;
	practiceSessions: number;
	importedNotes: number;
}) {
	const empty =
		propositions === 0 && chains === 0 && teachSessions === 0 && practiceSessions === 0 && importedNotes === 0;
	if (empty) {
		return (
			<p data-testid="knowledge-summary" className="mt-2 max-w-md text-base font-semibold text-muted-foreground">
				Start a session to begin learning. Attach your material with the paperclip or drag and drop.
			</p>
		);
	}
	const tiles: [number, string, string][] = [
		[propositions, "proposition", "propositions"],
		[chains, "chain", "chains"],
		[teachSessions, "teaching session", "teaching sessions"],
		[practiceSessions, "practice session", "practice sessions"],
		[importedNotes, "imported note", "imported notes"],
	];
	return (
		<div data-testid="knowledge-summary" className="mt-6 flex flex-wrap justify-center gap-3">
			{tiles.map(([n, one, many]) => (
				<div key={many} className="min-w-28 rounded-2xl border-2 bg-card px-4 py-3 shadow-[0_3px_0_var(--border)]">
					<p className="text-2xl font-black tabular-nums text-foreground">{n}</p>
					<p className="text-xs font-bold text-muted-foreground">{n === 1 ? one : many}</p>
				</div>
			))}
		</div>
	);
}

export function MinimalHome({
	showGraphControls = true,
	chainSelectOpen = false,
	practiceSelection,
	onPracticeSelectionChange,
	onChainSelectClose,
}: {
	showGraphControls?: boolean;
	chainSelectOpen?: boolean;
	practiceSelection?: ReadonlySet<string>;
	onPracticeSelectionChange?: (nodes: { id: string; name: string; statement: string }[]) => void;
	onChainSelectClose?: () => void;
}) {
	const [snapshot, setSnapshot] = useState<GraphSnapshot | null>(null);
	const [costs, setCosts] = useState<GraphCostSummary | null>(null);
	const [chats, setChats] = useState<ChatSummary[]>([]);
	const [chainsOpen, setChainsOpen] = useState(false);

	const readState = useCallback(() => {
		fetch("/api/graph")
			.then((res) => res.json() as Promise<GraphSnapshot>)
			.then(setSnapshot)
			.catch(() => {});
		if (showGraphControls) fetch("/api/graph/costs")
			.then((res) => res.json() as Promise<GraphCostSummary>)
			.then(setCosts)
			.catch(() => {});
		fetch("/api/chats")
			.then((res) => res.json() as Promise<{ chats: ChatSummary[] }>)
			.then((body) => setChats(body.chats))
			.catch(() => {});
	}, [showGraphControls]);
	useEffect(() => {
		readState();
		window.addEventListener("owlly:graph-revision", readState);
		return () => window.removeEventListener("owlly:graph-revision", readState);
	}, [readState]);

	useEffect(() => {
		if (chainSelectOpen) setChainsOpen(true);
	}, [chainSelectOpen]);

	const notesImport = useNotesImport({ onFinish: readState });
	const { importing, onImportFiles } = notesImport;

	const teachSessions = chats.filter((c) => c.kind === "teach").length;
	const practiceSessions = chats.filter((c) => c.kind === "practice").length;

	return (
		<div className="relative h-full">
			{ }
			<div className="pointer-events-none flex h-full items-center justify-center overflow-y-auto pb-40">
				<OwlHero>
				<KnowledgeSummary
					propositions={snapshot?.propositions.length ?? 0}
					chains={snapshot?.chains.length ?? 0}
					teachSessions={teachSessions}
					practiceSessions={practiceSessions}
					importedNotes={Object.keys(snapshot?.fileSources ?? {}).length}
				/>
				</OwlHero>
			</div>

			{
}
			{showGraphControls && <div className="absolute right-3 top-3 z-10 flex max-w-[calc(100%-5.5rem)] flex-col items-end gap-2">
				<div className="flex min-w-0 items-start gap-2">
					<div className="graph-chrome-fade-in shrink-0 rounded-2xl border-2 bg-card p-1 shadow-[0_3px_0_var(--border)]">
						<Hint label="Every reasoning chain" side="bottom">
							<button
								type="button"
								onClick={() => setChainsOpen(true)}
								data-testid="open-chain-table"
								className="flex h-8 items-center gap-1.5 rounded-xl px-3 text-sm font-extrabold text-foreground transition-colors hover:bg-accent"
							>
								<ListTreeIcon className="size-4 text-secondary" />
								Chains
							</button>
						</Hint>
					</div>
					<NotesImportControl importing={importing} onImportFiles={onImportFiles} />
				</div>
				<NotesImportErrors errors={notesImport.errors} />
				<NotesImportNotices notices={notesImport.notices} />
				{costs && costs.runs.length > 0 && <GraphCostControl costs={costs} />}
			</div>}

			{
}
			<ChainTableOverlay
				open={chainsOpen}
				nodes={snapshot?.propositions ?? []}
				chains={snapshot?.chains ?? []}
				sessions={snapshot?.sessions ?? {}}
				fileSources={snapshot?.fileSources ?? {}}
				onClose={() => {
					setChainsOpen(false);
					onChainSelectClose?.();
				}}
				selectMode={chainSelectOpen}
				controlledSelection={practiceSelection}
				onSelectionChange={(ids) => {
					const props = snapshot?.propositions ?? [];
					const picked: { id: string; name: string; statement: string }[] = [];
					for (const id of ids) {
						const n = props.find((node) => node.id === id);
						if (n) picked.push({ id: n.id, name: n.name, statement: n.statement });
					}
					onPracticeSelectionChange?.(picked);
				}}
			/>
		</div>
	);
}
