"use client";

import { useEffect, useRef } from "react";
import { DictationBar, useDictation, type Dictation } from "@/components/dictation";
import { claimPluginInputFocus } from "@/components/plugin-input-focus";
export { claimPluginInputFocus, dispatchFocusedPluginShortcut } from "@/components/plugin-input-focus";

export function usePluginDictation({ append, disabled = false }: {
	append: (text: string) => void | Promise<void>;
	disabled?: boolean;
}): Dictation {
	return useDictation({ append, destination: "explicit", disabled });
}

export function PluginDictationControl({ dictation, disabled = false }: {
	dictation: Dictation;
	disabled?: boolean;
}) {
	const rootRef = useRef<HTMLDivElement>(null);
	const latest = useRef({ dictation, disabled });
	latest.current = { dictation, disabled };
	useEffect(() => {
		const root = rootRef.current;
		if (!root) return;
		return claimPluginInputFocus(root, {
			toggleDictation: () => {
				const { dictation: current, disabled: blocked } = latest.current;
				if (!blocked || current.active) current.toggle();
			},
		});
	}, []);
	return (
		<div ref={rootRef} className="min-w-0 flex-1" data-testid="plugin-dictation-control">
			<DictationBar dictation={dictation} disabled={disabled} />
		</div>
	);
}
