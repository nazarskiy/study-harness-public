
export interface ServerEvents {
	"turn-started": { chatId: string };
	"turn-settled": { chatId: string };
	"jobs-changed": { chatId?: string };
	"activity-changed": Record<string, never>;
	"chats-changed": Record<string, never>;
	"sources-changed": Record<string, never>;
	"subscriptions-changed": Record<string, never>;
	"record-changed": { chatId: string };
	"compaction-changed": { chatId: string; running: boolean };
	"side-chats-changed": { chatId: string };
	"plugins-changed": Record<string, never>;
	"plugin-message": { pluginId: string; topic: string; data?: unknown };
}

export type ServerEventType = keyof ServerEvents;

export const SERVER_EVENT_TYPES = [
	"turn-started",
	"turn-settled",
	"jobs-changed",
	"activity-changed",
	"chats-changed",
	"sources-changed",
	"subscriptions-changed",
	"record-changed",
	"compaction-changed",
	"side-chats-changed",
	"plugins-changed",
	"plugin-message",
] as const satisfies readonly ServerEventType[];

export type ServerEvent<K extends ServerEventType = ServerEventType> = {
	[T in K]: { type: T } & ServerEvents[T];
}[K];

export type ServerEventListener = (event: ServerEvent) => void;

interface OwllyEventsGlobal {
	__lhEventBus?: Set<ServerEventListener>;
}

function listeners(): Set<ServerEventListener> {
	const g = globalThis as typeof globalThis & OwllyEventsGlobal;
	return (g.__lhEventBus ??= new Set());
}

export function subscribe(listener: ServerEventListener): () => void {
	const set = listeners();
	set.add(listener);
	return () => set.delete(listener);
}

export function emit<K extends ServerEventType>(type: K, payload: ServerEvents[K]): void {
	for (const listener of [...listeners()]) {
		try {
			listener({ type, ...payload } as ServerEvent);
		} catch (err) {
			console.error(`[events] listener failed on ${type}:`, err);
		}
	}
}
