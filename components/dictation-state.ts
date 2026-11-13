"use client";

import { useSyncExternalStore } from "react";

let active = false;
const listeners = new Set<() => void>();

export function isDictationActive(): boolean { return active; }

export function setDictationActive(next: boolean): void {
	if (active === next) return;
	active = next;
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => { listeners.delete(listener); };
}

export function useDictationActive(): boolean {
	return useSyncExternalStore(subscribe, isDictationActive, () => false);
}
