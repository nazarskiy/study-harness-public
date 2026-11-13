import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { AUTH_FILE } from "../../../config.ts";
import { comparisonPath, guardSourcePath, isWithin, realSourcePath as realOrMissing, resolvePolicy, type ResolvedFileAccessPolicy } from "./file-access.ts";


export const MAX_OUTPUT_BYTES = 50 * 1024;
export const GREP_MAX_LINE_LENGTH = 500;
export const WALK_TIMEOUT_MS = 10_000;

const EXCLUDED_DIR_NAMES = new Set(["node_modules", ".git", "Library", ".Trash"]);

const SENSITIVE_HOME_PATHS = [
	".claude",
	".codex",
	".cursor",
	".gemini",
	".ssh",
	".gnupg",
	".aws",
	".azure",
	".config/gcloud",
	".kube",
	".docker",
	".netrc",
	".npmrc",
	".pypirc",
	".git-credentials",
	"Library/Keychains",
	"Library/Cookies",
	"Library/Safari",
	"Library/Application Support/Google/Chrome",
	"Library/Application Support/BraveSoftware",
	"Library/Application Support/Microsoft Edge",
	"Library/Application Support/Firefox",
	".mozilla",
	".config/google-chrome",
	".config/chromium",
	".config/BraveSoftware",
	".config/microsoft-edge",
	"AppData/Local/Google/Chrome",
	"AppData/Local/BraveSoftware",
	"AppData/Local/Microsoft/Edge",
	"AppData/Roaming/Mozilla",
];

const ENV_FILE = /^\.env(\..*)?$/i;
const SUBSCRIPTION_FILES = ["chatgpt-credentials.json", "github-copilot-credentials.json", "xai-credentials.json"];
const CREDENTIAL_TEMP = /^(?:\.auth\.json\.tmp-\d+|(?:chatgpt|github-copilot|xai)-credentials\.json\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp)$/i;
const ATOMIC_TEMP_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function credentialFiles(authFile: string): string[] {
	return [authFile, ...SUBSCRIPTION_FILES.map((name) => path.join( path.dirname(authFile), name))];
}

function isCredentialTemp(absolute: string, directory: string, authBasename: string): boolean {
	const file = comparisonPath(absolute);
	if (path.relative(comparisonPath(directory), path.dirname(file)) !== "") return false;
	const name = path.basename(file);
	const prefix = `${authBasename}.tmp-`;
	return CREDENTIAL_TEMP.test(name) ||
		(name.toLowerCase().startsWith(prefix.toLowerCase()) && ATOMIC_TEMP_UUID.test(name.slice(prefix.length)));
}

export function isSensitivePath(absolute: string, home: string = os.homedir(), authFile: string = AUTH_FILE): boolean {
	const file = comparisonPath(absolute);
	return ENV_FILE.test(path.basename(file)) ||
		SENSITIVE_HOME_PATHS.some((p) => isWithin(file, path.join(home, p), true)) ||
		credentialFiles(authFile).some((p) => isWithin(file, p)) ||
		isCredentialTemp(file, path.dirname(authFile), path.basename(comparisonPath(authFile)));
}

function protectedRealPath(absolute: string): string {
	try { return realOrMissing(absolute); } catch { return absolute; }
}

export function sensitiveHomeLocations(
	home: string,
	readDirectory: (directory: string) => readonly string[] = (directory) => fsSync.readdirSync( directory),
): string[] {
	const listings = new Map<string, readonly string[]>();
	const entries = (directory: string): readonly string[] => {
		if (!listings.has(directory)) {
			try { listings.set(directory, readDirectory(directory)); }
			catch { listings.set(directory, []); }
		}
		return listings.get(directory)!;
	};
	return SENSITIVE_HOME_PATHS.flatMap((location) => {
		let candidates = [home];
		for (const segment of location.split("/")) {
			candidates = candidates.flatMap((parent) => {
				const variants = entries(parent).filter((entry) => entry.toLowerCase() === segment.toLowerCase());
				return (variants.length ? variants : [segment]).map((name) => path.join( parent, name));
			});
		}
		return candidates;
	});
}

function sourcePathCheck(home = os.homedir()): (absolute: string) => boolean {
	const homeRoots = sensitiveHomeLocations(home).map(protectedRealPath);
	const files = credentialFiles(AUTH_FILE).map(protectedRealPath);
	const credentialDir = protectedRealPath(path.dirname(AUTH_FILE));
	return (absolute) => isSensitivePath(absolute, home) ||
		homeRoots.some((p) => isWithin(absolute, p, true)) ||
		files.some((p) => isWithin(absolute, p)) || isCredentialTemp(absolute, credentialDir, path.basename(comparisonPath(AUTH_FILE)));
}

function checkedSourcePath(absolute: string, denied: (absolute: string) => boolean): string {
	const refuse = () => {
		throw new Error(
			`Access denied: ${absolute} is a protected location. Learner file tools cannot open it. ` +
			"Do not paste credentials or private transcripts into chat. Use another source or a manually reviewed, non-sensitive excerpt.",
		);
	};
	if (denied(absolute)) refuse();
	const real = realOrMissing(absolute);
	if (denied(real)) refuse();
	return real;
}

export function resolveSourcePath(p?: string, policy?: ResolvedFileAccessPolicy): string {
	const home = os.homedir();
	const resolved = !p ? home : p === "~" || p.startsWith("~/") || p.startsWith(`~${path.sep}`)
		? path.join(home, p.slice(1))
		: path.resolve(home, p);
	return guardSourcePath(checkedSourcePath(resolved, sourcePathCheck(home)), policy);
}

export function sourceSearchRoots(p?: string, policy: ResolvedFileAccessPolicy = resolvePolicy()): { roots: string[]; notices: string[]; multiRoot: boolean } {
	if (p || !policy.restricted) return { roots: [resolveSourcePath(p, policy)], notices: [], multiRoot: false };
	const notices = policy.unavailable.length ? [`Skipped ${policy.unavailable.length} unavailable allowed folder(s). Check File access settings`] : [];
	const roots: string[] = [];
	let protectedRoots = 0;
	for (const folder of policy.folders) {
		try { roots.push(resolveSourcePath(folder, policy)); }
		catch { protectedRoots++; }
	}
	if (protectedRoots) notices.push(`Skipped ${protectedRoots} protected allowed folder(s); sensitive-location denials cannot be overridden`);
	if (!roots.length) throw new Error("Access denied: no accessible allowed folders. Add or repair folders in Settings → Agent → Tools → File access.");
	return { roots, notices, multiRoot: true };
}

export function formatSize(bytes: number): string {
	return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)}KB` : `${bytes}B`;
}

export function capOutput(lines: string[]): { content: string; truncated: boolean } {
	const out: string[] = [];
	for (const line of lines) {
		const candidate = [...out, line].join("\n");
		if (Buffer.byteLength(candidate, "utf-8") > MAX_OUTPUT_BYTES) {
			return { content: out.join("\n"), truncated: true };
		}
		out.push(line);
	}
	return { content: out.join("\n"), truncated: false };
}

export function expandBraces(pattern: string): string[] {
	const open = pattern.indexOf("{");
	if (open === -1) return [pattern];
	const close = pattern.indexOf("}", open);
	if (close === -1) return [pattern];
	const before = pattern.slice(0, open);
	const after = pattern.slice(close + 1);
	const alts: string[] = [];
	for (const alt of pattern.slice(open + 1, close).split(",")) {
		alts.push(...expandBraces(before + alt + after));
	}
	return alts;
}

export function globToRegex(glob: string): RegExp {
	let re = "";
	for (let i = 0; i < glob.length; i++) {
		const c = glob[i]!;
		if (c === "*") {
			if (glob[i + 1] === "*") {
				re += "[\\s\\S]*";
				i++;
				if (glob[i + 1] === "/") i++;
			} else {
				re += "[^/]*";
			}
		} else if (c === "?") {
			re += "[^/]";
		} else {
			re += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		}
	}
	return new RegExp(`^${re}$`);
}

export function matchGlob(relativePath: string, pattern: string): boolean {
	const posix = relativePath.split(path.sep).join("/");
	const basename = posix.split("/").pop() ?? posix;
	for (const alt of expandBraces(pattern)) {
		if (!alt.includes("/")) {
			if (globToRegex(alt).test(basename)) return true;
		} else {
			let effective = alt;
			if (!effective.startsWith("/") && !effective.startsWith("**/") && effective !== "**") {
				effective = `**/${effective}`;
			}
			if (effective.startsWith("/")) effective = effective.slice(1);
			if (globToRegex(effective).test(posix)) return true;
		}
	}
	return false;
}

export async function walkFiles(
	root: string,
	visit: (filePath: string) => boolean | Promise<boolean>,
	signal?: AbortSignal,
	options: { policy?: ResolvedFileAccessPolicy; deadline?: number } = {},
): Promise<{ timedOut: boolean; aborted: boolean }> {
	const deadline = options.deadline ?? Date.now() + WALK_TIMEOUT_MS;
	let timedOut = false;
	let aborted = false;
	if (signal?.aborted) return { timedOut: false, aborted: true };
	const denied = sourcePathCheck();
	const realRoot = guardSourcePath(checkedSourcePath(path.resolve(root), denied), options.policy);

	const walkDir = async (dir: string): Promise<boolean> => {
		if (Date.now() > deadline) {
			timedOut = true;
			return true;
		}
		if (signal?.aborted) {
			aborted = true;
			return true;
		}
		let entries: import("node:fs").Dirent[];
		try {
			entries = await fs.readdir(dir, { withFileTypes: true });
		} catch {
			return false;
		}
		for (const entry of entries) {
			if (Date.now() > deadline) {
				timedOut = true;
				return true;
			}
			if (signal?.aborted) {
				aborted = true;
				return true;
			}
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				if (EXCLUDED_DIR_NAMES.has(entry.name) || denied(full)) continue;
				if (await walkDir(full)) return true;
			} else if (entry.isFile()) {
				if (denied(full)) continue;
				if (await visit(full)) return true;
			}
		}
		return false;
	};

	await walkDir(realRoot);
	return { timedOut, aborted };
}

export async function isBinaryFile(filePath: string): Promise<boolean> {
	const handle = await fs.open(filePath, "r");
	try {
		const buf = Buffer.alloc(8192);
		const { bytesRead } = await handle.read(buf, 0, 8192, 0);
		return buf.subarray(0, bytesRead).includes(0);
	} finally {
		await handle.close();
	}
}

export function truncateGrepLine(line: string): { text: string; wasTruncated: boolean } {
	if (line.length <= GREP_MAX_LINE_LENGTH) return { text: line, wasTruncated: false };
	return { text: `${line.slice(0, GREP_MAX_LINE_LENGTH)}… [truncated]`, wasTruncated: true };
}
