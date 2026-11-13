const aborted = () => new DOMException("Submission preparation canceled", "AbortError");
function abortable<T>(value: T | PromiseLike<T>, signal: AbortSignal): Promise<T> {
	if (signal.aborted) return Promise.reject(aborted());
	return new Promise((resolve, reject) => {
		const abort = () => reject(aborted());
		signal.addEventListener("abort", abort, { once: true });
		Promise.resolve(value).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
	});
}
export class SubmissionModelEpoch {
	private known: string | undefined;
	private revision = 0;
	observe(model: string | undefined) {
		if (model === undefined) return;
		if (this.known !== undefined && model !== this.known) this.revision++;
		this.known = model;
	}
	capture() { return this.revision; }
	isCurrent(revision: number) { return revision === this.revision; }
}

export class SubmissionRunner {
 private active: SubmissionAttempt | null = null;
 constructor(private changed: () => void = () => {}) {}
 get occupied() { return this.active !== null; }
 begin(current: () => boolean): SubmissionAttempt | null {
  if (this.active) return null;
  const attempt = new SubmissionAttempt(current, () => { if (this.active === attempt) { this.active = null; this.changed(); } });
  this.active = attempt; this.changed(); return attempt;
 }
 dispose() { this.active?.cancel(); }
}
export class SubmissionAttempt {
 private controller = new AbortController();
 private finished = false;
 private delivering = false;
 constructor(private current: () => boolean, private release: () => void) {}
 check() { if (this.controller.signal.aborted || !this.current()) { this.cancel(); throw aborted(); } }
 async finalize<T>(callback: () => T | Promise<T>): Promise<T> { this.check(); const result = await abortable(callback(), this.controller.signal); this.check(); return result; }
 preparationFailure(error: unknown): Error { return new Error(error instanceof Error ? error.message : String(error)); }
 deliver() { this.check(); this.delivering = true; }
 accepted = () => this.finish();
 refused = () => this.finish();
 cancel() { if (this.delivering) return; this.controller.abort(); this.finish(); }
 private finish() { if (this.finished) return; this.finished = true; this.release(); }
}
