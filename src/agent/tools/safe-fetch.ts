import { BlockList, isIP } from "node:net";
import { Agent, buildConnector, fetch as undiciFetch } from "undici";


const NON_PUBLIC = new BlockList();
for (const [network, prefix] of [
	["0.0.0.0", 8],
	["10.0.0.0", 8],
	["100.64.0.0", 10],
	["127.0.0.0", 8],
	["169.254.0.0", 16],
	["172.16.0.0", 12],
	["192.0.0.0", 24],
	["192.0.2.0", 24],
	["192.88.99.0", 24],
	["192.168.0.0", 16],
	["198.18.0.0", 15],
	["198.51.100.0", 24],
	["203.0.113.0", 24],
	["224.0.0.0", 4],
	["240.0.0.0", 4],
] as const) NON_PUBLIC.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
	["::", 128],
	["::1", 128],
	["64:ff9b::", 96],
	["64:ff9b:1::", 48],
	["100::", 64],
	["2001:db8::", 32],
	["2002::", 16],
	["fc00::", 7],
	["fe80::", 10],
	["ff00::", 8],
] as const) NON_PUBLIC.addSubnet(network, prefix, "ipv6");

export function isPublicAddress(address: string): boolean {
	const unbracketed = address.replace(/^\[|\]$/g, "");
	const mapped = unbracketed.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i)?.[1];
	const ip = mapped ?? unbracketed;
	const family = isIP(ip);
	if (family === 4) return !NON_PUBLIC.check(ip, "ipv4");
	if (family === 6) return !NON_PUBLIC.check(ip, "ipv6");
	return false;
}

export class BlockedAddressError extends Error {}

export function createAddressCheckedAgent(
	allowed: (address: string) => boolean = isPublicAddress,
	connectorOptions: Parameters<typeof buildConnector>[0] = {},
): Agent {
	const connect = buildConnector(connectorOptions);
	return new Agent({
		connect: (options, callback) => {
			connect(options, (error, socket) => {
				if (error || !socket) {
					callback(error ?? new Error("connection failed"), null);
					return;
				}
				const peer = socket.remoteAddress ?? "";
				if (!peer || !allowed(peer)) {
					socket.destroy();
					callback(new BlockedAddressError(`refusing to connect to a private or local address (${options.hostname})`), null);
					return;
				}
				callback(null, socket);
			});
		},
	});
}

const publicOnly = createAddressCheckedAgent();

export const safeFetchOverride: { current?: (url: string, init: RequestInit) => Promise<Response> } = {};

export async function safeFetch(url: string, init: RequestInit = {}, dispatcher: Agent = publicOnly): Promise<Response> {
	if (safeFetchOverride.current) return safeFetchOverride.current(url, init);
	try {
		return (await undiciFetch(url, { ...(init as object), dispatcher })) as unknown as Response;
	} catch (err) {
		const cause = (err as { cause?: unknown }).cause;
		if (cause instanceof BlockedAddressError) throw new Error(cause.message);
		throw err;
	}
}
