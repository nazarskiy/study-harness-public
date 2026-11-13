export type FilePathPart =
	| { kind: "text"; text: string; start: number; end: number }
	| { kind: "path"; text: string; path: string; start: number; end: number };

function isFilePath(path: string): boolean {
	if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(path)) return false;
	return path.startsWith("/")
		|| path.startsWith("~/")
		|| /^[a-z]:[\\/]/i.test(path)
		|| /^\\\\[^\\/]+[\\/][^\\/]+(?:[\\/]|$)/u.test(path);
}

export function quoteFilePath(path: string): string {
	if (!isFilePath(path)) throw new TypeError("Expected a single-line rooted file path");
	let width = 1;
	for (const run of path.matchAll(/`+/g)) width = Math.max(width, run[0].length + 1);
	const delimiter = "`".repeat(width);
	const padding = path.startsWith("`") || path.endsWith("`") ? " " : "";
	return `${delimiter}${padding}${path}${padding}${delimiter}`;
}

export function parseFilePaths(text: string): FilePathPart[] {
	const runs = Array.from(text.matchAll(/`+/g), (match) => ({
		start: match.index,
		end: match.index + match[0].length,
		width: match[0].length,
	}));
	const next = new Map<number, number>();
	const closing = new Map<number, number>();
	for (let i = runs.length - 1; i >= 0; i--) {
		const width = runs[i]!.width;
		const match = next.get(width);
		if (match !== undefined) closing.set(i, match);
		next.set(width, i);
	}

	const parts: FilePathPart[] = [];
	let plainStart = 0;
	for (let i = 0; i < runs.length; i++) {
		const closeIndex = closing.get(i);
		if (closeIndex === undefined) continue;
		const open = runs[i]!;
		const close = runs[closeIndex]!;
		let path = text.slice(open.end, close.start);
		if (path.startsWith(" ") && path.endsWith(" ") && /[^ ]/.test(path)) {
			path = path.slice(1, -1);
		}
		if (isFilePath(path)) {
			if (plainStart < open.start) {
				parts.push({ kind: "text", text: text.slice(plainStart, open.start), start: plainStart, end: open.start });
			}
			parts.push({ kind: "path", text: text.slice(open.start, close.end), path, start: open.start, end: close.end });
			plainStart = close.end;
		}
		i = closeIndex;
	}
	if (plainStart < text.length) {
		parts.push({ kind: "text", text: text.slice(plainStart), start: plainStart, end: text.length });
	}
	return parts;
}

function isWindowsPath(path: string): boolean {
	return /^[a-z]:[\\/]/i.test(path) || path.startsWith("\\\\");
}

export function isDirectoryReference(path: string): boolean {
	return path.endsWith("/") || (isWindowsPath(path) && path.endsWith("\\"));
}

export function directoryReferencePath(path: string): string {
	quoteFilePath(path);
	return isDirectoryReference(path) ? path : path + (isWindowsPath(path) ? "\\" : "/");
}

export function filePathLabel(path: string): string {
	const windows = isWindowsPath(path);
	const separator = windows ? /[\\/]/ : /\//;
	const trimmed = windows ? path.replace(/[\\/]+$/, "") : path.replace(/\/+$/, "");
	if (!trimmed || (windows && /^[a-z]:$/i.test(trimmed)) || trimmed === "~") return path;
	return trimmed.split(separator).at(-1) || path;
}
