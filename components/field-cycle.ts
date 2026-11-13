"use client";

import { useEffect } from "react";
import { isInteractionScopeEligible } from "./interaction-focus";
import { useOptionalInteractionLayers } from "./interaction-layers";

export function useFieldCycle(fields: () => readonly HTMLElement[]) {
	const controller = useOptionalInteractionLayers();
	useEffect(() => {
		const onCycle = () => {
			const list = fields().filter((el) => isInteractionScopeEligible(el, controller));
			if (list.length === 0) return;
			const active = document.activeElement;
			const idx = active ? list.findIndex((el) => el === active || el.contains(active)) : -1;
			if (idx < 0) {
				list[0]!.focus();
				return;
			}
			list[(idx + 1) % list.length]!.focus();
		};
		window.addEventListener("owlly:kbd-cycle-fields", onCycle);
		return () => window.removeEventListener("owlly:kbd-cycle-fields", onCycle);
	}, [fields, controller]);
}
