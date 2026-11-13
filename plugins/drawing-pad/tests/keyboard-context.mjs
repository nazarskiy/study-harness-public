import { useSyncExternalStore } from "react";

export function usePlugins() {
  const manager = window.fixture.actionManager();
  const snapshot = useSyncExternalStore(manager.subscribe, manager.getSnapshot, manager.getSnapshot);
  return { manager, snapshot, uiStore: null };
}
