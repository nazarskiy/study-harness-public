
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const TEMP_MARKER = ".tmp-";
const RENAME_RETRY_MS = 100;

export function writeFileAtomicSync(file: string, text: string, options?: { mode?: number; allowInPlaceFallback?: boolean }): void {
	const tmp = `${file}${TEMP_MARKER}${randomUUID()}`;
	let target: number;
	try {
		const fd = fs.openSync(tmp, "wx", options?.mode ?? 0o666);
		try {
			if (options?.mode !== undefined) fs.fchmodSync(fd, options.mode);
			fs.writeFileSync(fd, text, "utf-8");
			fs.fsyncSync(fd);
		} finally {
			fs.closeSync(fd);
		}
		if (renameRetryingSync(tmp, file, options?.allowInPlaceFallback ?? false)) return;
		target = fs.openSync(file, "w");
	} catch (error) {
		removeTemp(tmp);
		throw error;
	}
	try {
		fs.writeFileSync(target, text, "utf-8");
	} finally {
		fs.closeSync(target);
	}
	console.warn(`[store] ${file} is held open by another program; saved it in place`);
	removeTemp(tmp);
}

export function removeLeftoverTemps(file: string): void {
	const prefix = `${path.basename(file)}${TEMP_MARKER}`;
	let names: string[];
	try {
		names = fs.readdirSync(path.dirname(file));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.warn(`[store] could not look for temp files beside ${file}:`, error);
		return;
	}
	for (const name of names) if (name.startsWith(prefix)) removeTemp(path.join(path.dirname(file), name));
}

function renameRetryingSync(tmp: string, file: string, allowInPlaceFallback: boolean): boolean {
	const deadline = Date.now() + RENAME_RETRY_MS;
	for (let delay = 5; ; delay = Math.min(delay * 2, 40)) {
		try {
			fs.renameSync(tmp, file);
			return true;
		} catch (error) {
			if (!isSharingViolation(error, file)) throw error;
			if (Date.now() >= deadline) {
				if (allowInPlaceFallback && !fs.lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink()) return false;
				throw error;
			}
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
		}
	}
}

function isSharingViolation(error: unknown, file: string): boolean {
	const code = (error as NodeJS.ErrnoException).code;
	if (process.platform !== "win32" || (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY")) return false;
	let stat: fs.Stats | undefined;
	try {
		stat = fs.statSync(file, { throwIfNoEntry: false });
	} catch {
		return false;
	}
	if (!stat) return true;
	return stat.isFile() && (stat.mode & 0o200) !== 0;
}

function removeTemp(tmp: string): void {
	try {
		fs.unlinkSync(tmp);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.warn(`[store] could not remove temp file ${tmp}:`, error);
	}
}
