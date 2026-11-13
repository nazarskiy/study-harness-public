"use client";


import { HostDialog } from "@/components/host-dialog";
import { hasLegacyInteractionForeground } from "@/components/interaction-focus";
import { useOptionalInteractionLayers } from "@/components/interaction-layers";
import { useSettingsDialog } from "@/components/settings/settings-dialog.tsx";
import {
actionForBinding,
bindingForAction,
eventBinding,
formatBinding,
isTypingSurface,
kbdEventForAction,
KEYBOARD_ACTIONS,
} from "@/src/core";
import { useRouter } from "next/navigation";
import { useEffect,useId,useRef,useState } from "react";
import { composingQuestionKey } from "./input-keys";

export { kbdEventForAction };

export function KeyboardShortcuts() {
	const router = useRouter();
	const [cheatOpen, setCheatOpen] = useState(false);
	const { open: openSettings } = useSettingsDialog();
	const controller = useOptionalInteractionLayers();

	const handlersRef = useRef<{
		router: ReturnType<typeof useRouter>;
		setCheatOpen: (v: boolean) => void;
		openSettings: () => void;
	}>({ router, setCheatOpen, openSettings });
	handlersRef.current = { router, setCheatOpen, openSettings };

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (composingQuestionKey(e)) return;
			if (e.key === "Tab") {
				if (!controller) e.preventDefault();
				if (e.shiftKey) {
					window.dispatchEvent(new CustomEvent("owlly:kbd-cycle-thinking"));
				}
				else if (!e.metaKey && !e.ctrlKey && !e.altKey)
					window.dispatchEvent(new CustomEvent("owlly:kbd-cycle-fields"));
				return;
			}

			if (e.key === "Escape") {
				if (e.defaultPrevented || (controller ? controller.isEscapeOwned(e) : hasLegacyInteractionForeground(document))) return;
				window.dispatchEvent(new CustomEvent("owlly:kbd-abort-turn"));
				return;
			}

			if (e.defaultPrevented) return;
			const action = actionForBinding(eventBinding(e));
			if (!action) return;

			if (isTypingSurface(e) && !(e.metaKey || e.ctrlKey || e.altKey)) return;

			switch (action) {
				case "new-session":
					handlersRef.current.router.push("/chat/new");
					break;
				case "open-settings":
					handlersRef.current.openSettings();
					break;
				case "jump-graph":
					handlersRef.current.router.push("/");
					break;
				case "cheat-sheet":
					handlersRef.current.setCheatOpen(true);
					break;
				case "toggle-question-thread":
					e.preventDefault();
					window.dispatchEvent(new CustomEvent(kbdEventForAction(action)));
					break;
				case "find":
					e.preventDefault();
					window.dispatchEvent(new CustomEvent(kbdEventForAction(action)));
					break;
				default:
					window.dispatchEvent(new CustomEvent(kbdEventForAction(action)));
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [controller]);

	return <CheatSheet open={cheatOpen} onClose={() => setCheatOpen(false)} />;
}

function CheatSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
	const headingId = useId();
	const scopes = ["global", "chat", "graph"] as const;
	const scopeLabels: Record<(typeof scopes)[number], string> = {
		global: "Global",
		chat: "Chat",
		graph: "Graph view",
	};
	return (
		<HostDialog open={open} onClose={() => { onClose(); return "closed"; }} aria-labelledby={headingId}
			backdropProps={{
				"data-testid": "cheat-sheet",
				className: "fixed inset-0 z-50 flex items-center justify-center bg-black/50",
			}}
			frame={<div
				className="max-h-[80vh] w-full max-w-[36rem] overflow-y-auto rounded-3xl border-2 bg-card p-6 shadow-2xl"
				onClick={(e) => e.stopPropagation()}
			/>}
		>
				<div className="mb-4 flex items-baseline justify-between">
					<span id={headingId} role="heading" aria-level={2} className="text-xl font-black text-card-foreground">Keyboard shortcuts</span>
					<span className="text-xs font-bold text-muted-foreground">Esc to close</span>
				</div>
				{scopes.map((scope) => {
					const actions = KEYBOARD_ACTIONS.filter((a) => a.scope === scope);
					if (actions.length === 0) return null;
					return (
						<div key={scope} className="mb-4">
							<div className="mb-1.5 text-xs font-extrabold text-muted-foreground/70">
								{scopeLabels[scope]}
							</div>
							<div className="flex flex-col gap-1">
								{actions.map((a) => (
									<div key={a.id} className="flex items-center justify-between gap-4 text-sm">
										<span className="text-muted-foreground">{a.label}</span>
										<kbd className="rounded-lg border-2 border-b-4 border-border bg-card px-2 py-0.5 text-xs font-extrabold text-card-foreground">
											{formatBinding(bindingForAction(a.id))}
										</kbd>
									</div>
								))}
							</div>
						</div>
					);
				})}

		</HostDialog>
	);
}
