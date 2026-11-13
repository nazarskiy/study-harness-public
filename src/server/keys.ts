
import {
	AUTH_KEYS,
	AUTH_PROVIDER_KEYS,
	AUTH_PROVIDER_ENV_VARS,
	CUSTOM_PROVIDER,
	type AuthKeyInfo,
	type AuthKeyStatus,
	genericProviderKeyGuard,
	isKnownAuthKey,
	isProviderEnvVar,
	maskKey,
	validateKeyShape,
} from "../core/auth-keys.ts";
import { authStore } from "../store/auth.ts";
import { isSubscriptionProvider, subscriptionConnected } from "../agent/subscription-connections.ts";
import { customProviderAvailable, installCustomProviderSource } from "./custom-provider.ts";
import { claudeCodeAvailable } from "./claude-code-config.ts";
import { CLAUDE_CODE_PROVIDER } from "../agent/claude-code/constants.ts";
import { CUSTOM_AUTH_BINDING } from "../core/custom-provider-auth.ts";

import { authEnvRecord as boot } from "../core/auth-env.ts";

export function isWritableAuthKey(id: string): boolean {
	return id !== CUSTOM_AUTH_BINDING && id !== CUSTOM_PROVIDER.envVar && (isKnownAuthKey(id) || isProviderEnvVar(id));
}

export function providerKeyList() {
	return [...AUTH_PROVIDER_KEYS].sort((a, b) => a.id.localeCompare(b.id));
}

export function envKeysIgnored(): boolean {
	return process.env.OWLLY_IGNORE_ENV_KEYS === "1";
}

export function initAuthEnv(): void {
	const record = boot();
	const fileVars = Object.fromEntries(Object.entries(authStore.authVars()).filter(([name]) => name !== CUSTOM_AUTH_BINDING));
	const managed = new Set<string>([
		...Object.keys(fileVars),
		...AUTH_KEYS.map((k) => k.id),
		...AUTH_PROVIDER_KEYS.map((p) => p.envVar),
		CUSTOM_PROVIDER.envVar,
	]);
	if (envKeysIgnored()) {
		for (const name of managed) {
			delete process.env[name];
		}
	} else if (record.realEnv.size === 0 && record.fillGap.size === 0) {
		for (const name of managed) {
			if (process.env[name] !== undefined) record.realEnv.add(name);
		}
	}
	for (const [name, value] of Object.entries(fileVars)) {
		if (!isManagedName(name)) continue;
		if (process.env[name] === undefined) {
			process.env[name] = value;
			record.fillGap.add(name);
		}
	}
}

function isManagedName(name: string): boolean {
	return name !== CUSTOM_AUTH_BINDING && (isWritableAuthKey(name) || name in authStore.authVars());
}

export function resolveKeyStatuses(
	fileVars: Record<string, string>,
	env: Record<string, string | undefined>,
	realEnv: ReadonlySet<string>,
	providerEnvVars: ReadonlySet<string> = new Set(),
): AuthKeyStatus[] {
	const ids = new Set<string>([...AUTH_KEYS.map((k) => k.id), ...Object.keys(fileVars)]);
	for (const envVar of providerEnvVars) {
		if (env[envVar] !== undefined || fileVars[envVar] !== undefined) ids.add(envVar);
	}
	const rows: AuthKeyStatus[] = [];
	for (const id of ids) {
		if (id === CUSTOM_AUTH_BINDING) continue;
		const envValue = env[id];
		const fileValue = fileVars[id];
		const isRealEnv = realEnv.has(id);
		const live = envValue !== undefined ? envValue : fileValue;
		rows.push({
			id,
			info: AUTH_KEYS.find((k) => k.id === id) ?? null,
			present: live !== undefined,
			masked: live !== undefined ? id === CUSTOM_PROVIDER.envVar ? "••••" : `${maskKey(live)} (${live.trim().length} chars)` : null,
			source: isRealEnv ? "env" : live !== undefined ? "file" : "none",
			shadowedByEnv: isRealEnv && fileValue !== undefined && envValue !== fileValue,
		});
	}
	return rows;
}

export function keyStatuses(): AuthKeyStatus[] {
	return resolveKeyStatuses(authStore.authVars(), process.env, boot().realEnv, new Set([...AUTH_PROVIDER_ENV_VARS, CUSTOM_PROVIDER.envVar]));
}

export function keyValue(id: string): string | undefined {
	if (id === CUSTOM_AUTH_BINDING) return undefined;
	if (envKeysIgnored()) return authStore.authVars()[id];
	return process.env[id] ?? authStore.authVars()[id];
}

export function providerKeyPresent(provider: string): boolean {
	if (provider === CUSTOM_PROVIDER.id) return customProviderAvailable();
	if (provider === CLAUDE_CODE_PROVIDER) return claudeCodeAvailable();
	if (isSubscriptionProvider(provider)) return subscriptionConnected(provider);
	const info = AUTH_PROVIDER_KEYS.find((p) => p.id === provider);
	return info ? keyValue(info.envVar) !== undefined : true;
}

export function saveKey(id: string, value: string): { ok: true; status: AuthKeyStatus } | { ok: false; error: string } {
	if (id === CUSTOM_PROVIDER.envVar || id === CUSTOM_AUTH_BINDING) return { ok: false, error: "Use the custom endpoint editor" };
	const shape = isProviderEnvVar(id) ? genericProviderKeyGuard(id, value) : validateKeyShape(id, value);
	if (!shape.ok) return { ok: false, error: shape.error };
	const trimmed = value.trim();
	authStore.setAuthVar(id, trimmed);
	const record = boot();
	if (!record.realEnv.has(id)) {
		process.env[id] = trimmed;
		record.fillGap.add(id);
	}
	return { ok: true, status: keyStatuses().find((s) => s.id === id)! };
}

export function deleteKey(id: string): AuthKeyStatus {
	if (id === CUSTOM_PROVIDER.envVar || id === CUSTOM_AUTH_BINDING) throw new Error("Use the custom endpoint editor");
	authStore.deleteAuthVar(id);
	const record = boot();
	if (record.fillGap.has(id) && !record.realEnv.has(id)) {
		delete process.env[id];
		record.fillGap.delete(id);
	}
	return keyStatuses().find((s) => s.id === id)!;
}

initAuthEnv();
installCustomProviderSource();
