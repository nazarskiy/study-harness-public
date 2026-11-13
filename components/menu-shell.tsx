"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { INTERACTION_LAYER_Z_BASE } from "./host-dialog";
import { InteractionLayerOwner, useInteractionLayer, useInteractionLayers, type CloseOutcome, type CloseReason } from "./interaction-layers";


const GAP = 4;
const EDGE = 8;
const CAP_VH = 0.6;
const MIN_USABLE = 96;

export const MENU_OPEN_EVENT = "owlly:menu-open";
export const MENU_CLOSE_EVENT = "owlly:menu-close";

export type MenuSide = "up" | "down";
export type MenuAlign = "left" | "right";

export interface MenuPlacement {
	side: MenuSide;
	style: Record<string, string | number>;
	maxHeight: number;
}

export function computeMenuPlacement(
	rect: { top: number; bottom: number; left: number; right: number },
	viewport: { width: number; height: number },
	contentHeight: number,
	preferredSide: MenuSide,
	align: MenuAlign,
): MenuPlacement {
	const availDown = viewport.height - EDGE - (rect.bottom + GAP);
	const availUp = rect.top - GAP - EDGE;
	let side = preferredSide;
	if (contentHeight > 0) {
		const preferredAvail = preferredSide === "down" ? availDown : availUp;
		const otherAvail = preferredSide === "down" ? availUp : availDown;
		if (contentHeight > preferredAvail && otherAvail > preferredAvail) {
			side = preferredSide === "down" ? "up" : "down";
		}
	}
	const avail = side === "down" ? availDown : availUp;
	const maxHeight = Math.max(MIN_USABLE, Math.min(CAP_VH * viewport.height, avail));
	const horizontal: Record<string, number> =
		align === "right" ? { right: viewport.width - rect.right } : { left: rect.left };
	const vertical: Record<string, number> =
		side === "down" ? { top: rect.bottom + GAP } : { bottom: viewport.height - rect.top + GAP };
	return { side, style: { ...horizontal, ...vertical }, maxHeight };
}

type AnchorRect = { top: number; bottom: number; left: number; right: number };

export function menuAnchorRect(
	{ getAnchorRect, anchorRef, anchorTestid }: { getAnchorRect?: () => AnchorRect | null; anchorRef?: RefObject<HTMLElement | null>; anchorTestid?: string },
	doc: Pick<Document, "querySelector">,
): AnchorRect | null {
	const virtual = getAnchorRect?.();
	if (virtual) return virtual;
	const element = anchorRef ? anchorRef.current : anchorTestid !== undefined ? doc.querySelector(`[data-testid="${anchorTestid}"]`) : null;
	return element?.getBoundingClientRect() ?? null;
}

export function MenuShell({
	anchorRef,
	anchorTestid,
	getAnchorRect,
	testid,
	preferredSide,
	align = "right",
	menuClass,
	children,
	onClose,
	ownerId,
}: {
	anchorRef?: RefObject<HTMLElement | null>;
	anchorTestid?: string;
	getAnchorRect?: () => AnchorRect | null;
	testid: string;
	preferredSide: MenuSide;
	align?: MenuAlign;
	menuClass: string;
	children: ReactNode;
	onClose?: (reason: CloseReason) => CloseOutcome | void;
	ownerId?: string;
}) {
	const menuRef = useRef<HTMLDivElement>(null);
	const [placed, setPlaced] = useState<MenuPlacement | null>(null);
	const focusedOnceRef = useRef(false);
	const controller = useInteractionLayers();
	const anchor = () => {
		if (anchorRef) return anchorRef.current;
		if (anchorTestid !== undefined && typeof document !== "undefined") return document.querySelector(`[data-testid="${anchorTestid}"]`);
		return null;
	};
	const resolvedAnchorRef = useRef<HTMLElement | null>(null);
	useLayoutEffect(() => { resolvedAnchorRef.current = anchor() as HTMLElement | null; });
	const originOwner = controller.ownerOf(anchor());
	const layer = useInteractionLayer({ kind: "popup", enabled: true, rootRef: menuRef, anchorRef: anchorRef ?? resolvedAnchorRef, ownerId: ownerId ?? originOwner?.id, onClose });
	const portal = controller.getPortalContainer(anchor(), ownerId ?? originOwner?.id);

	useEffect(() => {
		window.dispatchEvent(new CustomEvent(MENU_OPEN_EVENT));
		return () => {
			window.dispatchEvent(new CustomEvent(MENU_CLOSE_EVENT));
		};
	}, []);

	useEffect(() => {
		if (placed === null || focusedOnceRef.current || !layer.isTop) return;
		focusedOnceRef.current = true;
		const el = menuRef.current;
		if (!el) return;
		const input = el.querySelector<HTMLElement>("input, textarea");
		(input ?? el).focus();
	}, [placed, layer.isTop]);

	const onBodyKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
		if (!controller.isElementEligible(menuRef.current)) return;
		if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
		const { key } = e;
		if (key !== "ArrowDown" && key !== "ArrowUp" && key !== "Home" && key !== "End") return;
		const buttons = Array.from(
			menuRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? [],
		);
		if (buttons.length === 0) return;
		e.preventDefault();
		if (key === "Home") {
			buttons[0]?.focus();
			return;
		}
		if (key === "End") {
			buttons[buttons.length - 1]?.focus();
			return;
		}
		const delta = key === "ArrowDown" ? 1 : -1;
		const idx = buttons.findIndex((b) => b === document.activeElement);
		const base = idx === -1 ? (delta > 0 ? -1 : 0) : idx;
		const next = (base + delta + buttons.length) % buttons.length;
		buttons[next]?.focus();
	};

	const getAnchorRectRef = useRef(getAnchorRect);
	getAnchorRectRef.current = getAnchorRect;

	useLayoutEffect(() => {
		let raf = 0;
		const place = () => {
			const rect = menuAnchorRect({ getAnchorRect: getAnchorRectRef.current, anchorRef, anchorTestid }, document);
			if (!rect || !menuRef.current) return;
			const p = computeMenuPlacement(
				rect,
				{ width: window.innerWidth, height: window.innerHeight },
				menuRef.current.scrollHeight,
				preferredSide,
				align,
			);
			setPlaced(p);
		};
		place();
		const rePlace = () => {
			cancelAnimationFrame(raf);
			raf = requestAnimationFrame(place);
		};
		window.addEventListener("scroll", rePlace, true);
		window.addEventListener("resize", rePlace);
		return () => {
			cancelAnimationFrame(raf);
			window.removeEventListener("scroll", rePlace, true);
			window.removeEventListener("resize", rePlace);
		};
	}, [anchorRef, anchorTestid, preferredSide, align]);

	if (!portal) return null;
	if (placed === null) {
		return createPortal(
			<InteractionLayerOwner.Provider value={layer.id}><div
				ref={menuRef}
				data-testid={testid}
				data-owlly-menu=""
				style={{ position: "fixed", left: 0, top: 0, visibility: "hidden" }}
				className={menuClass}
			>
				{children}
			</div></InteractionLayerOwner.Provider>,
			portal,
		);
	}
	return createPortal(
		<InteractionLayerOwner.Provider value={layer.id}><div
			ref={menuRef}
			data-testid={testid}
			data-owlly-menu=""
			tabIndex={-1}
			onKeyDown={onBodyKeyDown}
			style={{ position: "fixed", zIndex: INTERACTION_LAYER_Z_BASE + layer.order, ...placed.style, maxHeight: placed.maxHeight, overflowY: "auto" }}
			className={`${menuClass} outline-none`}
		>
			{children}
		</div></InteractionLayerOwner.Provider>,
		portal,
	);
}