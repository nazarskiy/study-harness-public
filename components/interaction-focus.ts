"use client";

import { isInteractionElementVisible,type InteractionLayersController } from "./interaction-layers";

const FOREGROUND_ROOTS = '[data-owlly-menu], [data-radix-popper-content-wrapper], [role="menu"], [role="dialog"], [data-testid="cheat-sheet"], [data-testid="chain-table-overlay"], [data-testid="mermaid-overlay"], [data-testid="plan-popup"]';

export function hasLegacyInteractionForeground(doc: Document, scope?: HTMLElement | null): boolean {
	return Array.from(doc.querySelectorAll<HTMLElement>(FOREGROUND_ROOTS)).some(element => {
		if (element.contains(scope ?? null) || element.getAttribute("data-state") === "closed") return false;
		if (!isInteractionElementVisible(element)) return false;
		const style = doc.defaultView?.getComputedStyle?.(element) ?? element.style;
		return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
	});
}

export function isInteractionScopeEligible(scope: HTMLElement | null, controller?: InteractionLayersController | null): boolean {
	if (!isInteractionElementVisible(scope)) return false;
	if (!controller) return !hasLegacyInteractionForeground(scope.ownerDocument, scope);
	if (!controller.isElementEligible(scope)) return false;
	const foreground = controller.getTopLayer();
	if (foreground?.kind === "view") {
		const owner = controller.ownerOf(scope);
		if (!owner || !controller.belongsTo(owner.id, foreground.id)) return false;
	}
	return true;
}

export function isInputShortcutScopeEligible(scope: HTMLElement | null, controller?: InteractionLayersController | null): boolean {
	return isInteractionScopeEligible(scope, controller) || !!controller?.isPopupOrigin(scope);
}

