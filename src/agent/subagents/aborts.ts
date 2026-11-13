
interface OwllyAbortGlobal {
	__lhJobAborts?: Map<string, AbortController>;
}

function registry(): Map<string, AbortController> {
	const g = globalThis as typeof globalThis & OwllyAbortGlobal;
	return (g.__lhJobAborts ??= new Map());
}

export function registerJobAbort(jobId: string, controller: AbortController): void {
	registry().set(jobId, controller);
}

export function unregisterJobAbort(jobId: string): void {
	registry().delete(jobId);
}

export function isJobLive(jobId: string): boolean {
	return registry().has(jobId);
}

export function fireJobAbort(jobId: string): boolean {
	const controller = registry().get(jobId);
	if (!controller) return false;
	registry().delete(jobId);
	controller.abort();
	return true;
}
