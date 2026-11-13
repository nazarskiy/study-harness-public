
import fs from "node:fs";
import path from "node:path";
import { AUTH_FILE } from "../../config.ts";
import type { AuthStore } from "../core/ports.ts";
import { CUSTOM_PROVIDER } from "../core/auth-keys.ts";
import { CUSTOM_AUTH_BINDING, parseCustomAuthBinding, type CustomAuthBinding } from "../core/custom-provider-auth.ts";
import { writeFileAtomicSync } from "./atomic-write.ts";

function readMap(): Record<string, string> {
	try {
		const raw = JSON.parse(fs.readFileSync(AUTH_FILE, "utf-8"));
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
		return Object.fromEntries(
			Object.entries(raw).filter(([, v]) => typeof v === "string") as [string, string][],
		);
	} catch {
		return {};
	}
}

function writeMap(map: Record<string, unknown>): void {
	fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
	writeFileAtomicSync(AUTH_FILE, `${JSON.stringify(map, null, "\t")}\n`, { mode: 0o600 });
}

export const authStore: AuthStore = {
	authVars() {
		return readMap();
	},
	setAuthVar(name, value) {
		assertOrdinaryVar(name);
		const map = readMap();
		map[name] = value;
		writeMap(map);
	},
	deleteAuthVar(name) {
		assertOrdinaryVar(name);
		const map = readMap();
		if (!(name in map)) return;
		delete map[name];
		writeMap(map);
	},
};

function readCustomMap(): Record<string, unknown> {
	let text: string;
	try { text = fs.readFileSync(AUTH_FILE, "utf8"); }
	catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}; throw new Error("Custom authorization storage unavailable"); }
	let raw: unknown;
	try { raw = JSON.parse(text); } catch { throw new Error("Custom authorization storage unavailable"); }
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Custom authorization storage unavailable");
	const map = raw as Record<string, unknown>;
	if (Object.hasOwn(map, CUSTOM_AUTH_BINDING) && !parseCustomAuthBinding(map[CUSTOM_AUTH_BINDING])) throw new Error("Invalid custom authorization record");
	if (Object.hasOwn(map, CUSTOM_PROVIDER.envVar) && typeof map[CUSTOM_PROVIDER.envVar] !== "string") throw new Error("Invalid custom credential record");
	return map;
}
function assertOrdinaryVar(name: string): void {
	if (name === CUSTOM_AUTH_BINDING || name === CUSTOM_PROVIDER.envVar) throw new Error("Use the custom endpoint editor");
}
export function readCustomAuth() {
	const map = readCustomMap();
	return { binding: parseCustomAuthBinding(map[CUSTOM_AUTH_BINDING]), fileKey: () => map[CUSTOM_PROVIDER.envVar] as string | undefined };
}
export function writeCustomAuth(binding: CustomAuthBinding | undefined, fileKey: string | undefined): void {
	const map = readCustomMap();
	if (binding && !parseCustomAuthBinding(JSON.stringify(binding))) throw new Error("Invalid custom authorization record");
	if (fileKey === undefined) delete map[CUSTOM_PROVIDER.envVar];
	else Object.defineProperty(map, CUSTOM_PROVIDER.envVar, { value: fileKey, enumerable: true, configurable: true, writable: true });
	if (binding === undefined) delete map[CUSTOM_AUTH_BINDING];
	else Object.defineProperty(map, CUSTOM_AUTH_BINDING, { value: JSON.stringify(binding), enumerable: true, configurable: true, writable: true });
	writeMap(map);
}
