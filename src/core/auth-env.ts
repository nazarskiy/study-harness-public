interface AuthBoot {
	realEnv: Set<string>;
	fillGap: Set<string>;
}
const BOOT_KEY = Symbol.for("owlly.authBoot");

export function authEnvRecord(): AuthBoot {
	const g = globalThis as Record<symbol, AuthBoot | undefined>;
	if (!g[BOOT_KEY]) g[BOOT_KEY] = { realEnv: new Set(), fillGap: new Set() };
	return g[BOOT_KEY];
}

export function externalCliEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
	const result = { ...env };
	const { realEnv, fillGap } = authEnvRecord();
	for (const name of fillGap) {
		if (!realEnv.has(name)) delete result[name];
	}
	return result;
}
