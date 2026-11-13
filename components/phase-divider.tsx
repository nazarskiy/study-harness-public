import { BookOpenIcon } from "@/components/ui/icons";
import type { Phase3 } from "@/src/core";


const CHIP_LABEL: Record<Phase3, string> = {
	probe: "Probing",
	plan: "Planning",
	teach: "Learn",
};

export function PhaseChip({ phase }: { phase: Phase3 }) {
	return (
		<span
			data-testid="phase-chip"
			data-phase={phase}
			role="img"
			aria-label={CHIP_LABEL[phase]}
			title={CHIP_LABEL[phase]}
			className={`flex shrink-0 select-none items-center rounded-full bg-secondary-soft text-xs font-extrabold text-secondary ${phase === "teach" ? "size-8 justify-center" : "px-3 py-1"}`}
		>
			{phase === "teach" ? <BookOpenIcon aria-hidden className="size-4" /> : CHIP_LABEL[phase]}
		</span>
	);
}

export function PhaseDivider({ phase, nodeCount }: { phase: Phase3; nodeCount?: number }) {
	if (phase === "probe") return null;
	const label =
		phase === "plan" && nodeCount
			? `Plan · ${nodeCount} node${nodeCount === 1 ? "" : "s"}`
			: CHIP_LABEL[phase];
	return (
		<div className="my-4 flex w-full items-center gap-3" data-testid={`phase-divider-${phase}`}>
			<span className="h-0.5 flex-1 rounded-full bg-border" aria-hidden />
			<span className="rounded-full border-2 border-secondary/40 bg-secondary-soft px-3 py-1 text-xs font-extrabold text-secondary">
				{label}
			</span>
			<span className="h-0.5 flex-1 rounded-full bg-border" aria-hidden />
		</div>
	);
}

export function planNodeCount(
	message: { parts: ReadonlyArray<{ type: string; state?: string; output?: unknown; [k: string]: unknown }> },
): number | undefined {
	for (const part of message.parts) {
		if (!part.type.startsWith("tool-plan_") || part.state !== "output-available") continue;
		const tree = (part.output as { tree?: { nodes?: unknown[] } } | undefined)?.tree;
		if (tree && Array.isArray(tree.nodes) && tree.nodes.length > 0) return tree.nodes.length;
	}
	return undefined;
}
