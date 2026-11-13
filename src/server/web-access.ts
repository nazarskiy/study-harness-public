import { isIP } from "node:net";

export function subscriptionRequestOrigin(request: Request): string | undefined {
	try {
		const url = new URL(request.url);
		const host = request.headers.get("host") ?? url.host;
		const addressed = new URL(`${url.protocol}//${host}`);
		if (!["http:", "https:"].includes(addressed.protocol) || addressed.username || addressed.password || addressed.pathname !== "/" || addressed.search || addressed.hash) return;
		return addressed.origin;
	} catch { return; }
}

export function browserHostAllowed(host: string | null, env: Record<string, string | undefined> = process.env): boolean {
	if (!host) return false;
	let hostname: string;
	try {
		hostname = new URL(`http://${host}`).hostname.toLowerCase();
	} catch {
		return false;
	}
	if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
	if (isIP(hostname.replace(/^\[|\]$/g, "")) !== 0) return true;
	const allowed = (env.OWLLY_ALLOWED_HOSTS ?? "").split(",").map((name) => name.trim().toLowerCase()).filter(Boolean);
	return allowed.includes(hostname);
}

export function apiRequestRefusal(request: Request, env: Record<string, string | undefined> = process.env): string | undefined {
	return browserAPIRefusal(request, env);
}

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function browserAPIRefusal(request: Request, env: Record<string, string | undefined> = process.env): string | undefined {
	if (!browserHostAllowed(request.headers.get("host") ?? new URL(request.url).host, env)) {
		return "This host name is not allowed. Use localhost or an IP address, or add the name to OWLLY_ALLOWED_HOSTS.";
	}
	if (READ_METHODS.has(request.method.toUpperCase())) return;
	const site = request.headers.get("sec-fetch-site");
	const origin = request.headers.get("origin");
	if ((site !== null && site !== "same-origin") || (origin !== null && origin !== subscriptionRequestOrigin(request))) {
		return "Cross-site requests to the Owlly API are not allowed.";
	}
}
