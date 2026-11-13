
import { emit } from "../core/events.ts";
import { clearTurnFailure } from "./turn-runs.ts";

interface TurnOwner {
	token: object;
	preparing: boolean;
}

interface OwllyGlobal {
	__lhTurnRegistry?: Map<string, number>;
	__lhTurnOwners?: Map<string, TurnOwner>;
}

function registry(): Map<string, number> {
	const g = globalThis as typeof globalThis & OwllyGlobal;
	return (g.__lhTurnRegistry ??= new Map<string, number>());
}

function owners(): Map<string, TurnOwner> {
	const g = globalThis as typeof globalThis & OwllyGlobal;
	return (g.__lhTurnOwners ??= new Map<string, TurnOwner>());
}

const inFlight = registry();
const MAX_TURN_MS = 30 * 60_000;

export function beginTurn(chatId: string, preparationOwner?: object): boolean {
	if (isTurnRunning(chatId)) return false;
	clearTurnFailure(chatId);
	if (preparationOwner) owners().set(chatId, { token: preparationOwner, preparing: true });
	else owners().delete(chatId);
	inFlight.set(chatId, Date.now());
	emit("turn-started", { chatId });
	return true;
}

export function endTurn(chatId: string, owner?: object): void {
	if (owner && owners().get(chatId)?.token !== owner) return;
	owners().delete(chatId);
	if (inFlight.delete(chatId)) emit("turn-settled", { chatId });
}

export function isTurnOwner(chatId: string, owner: object): boolean {
	return isTurnRunning(chatId) && owners().get(chatId)?.token === owner;
}

export function handoffTurn(chatId: string, owner: object): boolean {
	if (!isTurnOwner(chatId, owner)) return false;
	owners().get(chatId)!.preparing = false;
	inFlight.set(chatId, Date.now());
	return true;
}

export function isTurnRunning(chatId: string): boolean {
	const since = inFlight.get(chatId);
	if (since === undefined) return false;
	if (!owners().get(chatId)?.preparing && Date.now() - since > MAX_TURN_MS) {
		inFlight.delete(chatId);
		owners().delete(chatId);
		return false;
	}
	return true;
}
