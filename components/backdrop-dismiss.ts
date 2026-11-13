"use client";

import { useRef, type MouseEvent, type PointerEvent } from "react";

export function useBackdropDismiss(onDismiss: () => void) {
	const gesture = useRef<{
		pointerId: number;
		backdrop: HTMLDivElement;
		released: boolean;
	} | null>(null);

	return {
		onPointerDownCapture(event: PointerEvent<HTMLDivElement>) {
			gesture.current = event.isPrimary && event.button === 0 && event.target === event.currentTarget
				? { pointerId: event.pointerId, backdrop: event.currentTarget, released: false }
				: null;
			if (gesture.current && event.currentTarget.hasPointerCapture?.(event.pointerId)) {
				event.currentTarget.releasePointerCapture(event.pointerId);
			}
		},
		onPointerUpCapture(event: PointerEvent<HTMLDivElement>) {
			const press = gesture.current;
			gesture.current = press && press.pointerId === event.pointerId &&
				event.isPrimary && event.button === 0 && event.target === event.currentTarget &&
				press.backdrop === event.currentTarget
				? { ...press, released: true }
				: null;
		},
		onPointerCancelCapture() {
			gesture.current = null;
		},
		onClickCapture(event: MouseEvent<HTMLDivElement>) {
			const press = gesture.current;
			gesture.current = null;
			if (press?.released && press.backdrop === event.currentTarget &&
				event.button === 0 && event.target === event.currentTarget) {
				onDismiss();
			}
		},
	};
}
