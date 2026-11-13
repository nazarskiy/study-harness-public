"use client";

import { BookOpenIcon, CheckIcon, TrophyIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

const MODES = [
	{ id: "teach", label: "Learn", description: "Explore ideas with your owl tutor", icon: BookOpenIcon },
	{ id: "practice", label: "Challenge", description: "Put your knowledge to the test", icon: TrophyIcon },
] as const;

export function SessionModeCards({ mode, onChange, disabled = false }: {
	mode: "teach" | "practice";
	onChange: (mode: "teach" | "practice") => void;
	disabled?: boolean;
}) {
	return (
		<div className="mb-3 grid grid-cols-2 gap-2" role="group" aria-label="Session mode" data-testid="home-mode-switch">
			{MODES.map(({ id, label, description, icon: Icon }) => (
				<button key={id} type="button" data-testid={`home-mode-${id}`} aria-pressed={mode === id}
					disabled={disabled} onClick={() => onChange(id)}
					className={cn("flex min-w-0 items-start gap-2.5 rounded-2xl border-2 p-3 text-left transition-colors disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary",
						mode === id ? "border-secondary bg-secondary-soft text-secondary" : "border-border bg-card text-muted-foreground hover:border-secondary/50 hover:bg-muted")}>
					<Icon aria-hidden className="mt-0.5 size-5 shrink-0" />
					<span className="min-w-0 flex-1"><span className="block text-sm font-extrabold">{label}</span><span className="mt-0.5 block text-xs font-medium leading-relaxed">{description}</span></span>
					{mode === id && <CheckIcon aria-hidden className="hidden size-4 shrink-0 sm:block" />}
				</button>
			))}
		</div>
	);
}
