import assert from "node:assert/strict";
import { test } from "node:test";
import { SubmissionModelEpoch, SubmissionRunner } from "../components/submission-runner.ts";

test("native submissions await capture, prevent duplicates and release after acceptance", async () => {
 const runner = new SubmissionRunner();
 const attempt = runner.begin(() => true)!;
 assert.equal(runner.begin(() => true), null);
 let finish!: () => void;
 let text = "draft";
 const pendingCapture = new Promise<void>(resolve => { finish = resolve; });
 const capture = attempt.finalize(async () => { await pendingCapture; return text; });
 text = "draft updated during capture";
 finish();
 assert.equal(await capture, text);
 attempt.deliver();
 attempt.accepted();
 assert.equal(runner.occupied, false);
 const next = runner.begin(() => true)!;
 next.refused();
 assert.equal(runner.occupied, false);
});

test("navigation/disposal cancels a pending native submission before delivery", async () => {
 const runner = new SubmissionRunner();
 const attempt = runner.begin(() => true)!;
 const pending = attempt.finalize(() => new Promise<string>(() => {}));
 runner.dispose();
 await assert.rejects(pending, { name: "AbortError" });
 assert.equal(runner.occupied, false);
});

test("changing models invalidates a captured native submission", async () => {
 const model = new SubmissionModelEpoch();
 model.observe("first-model");
 const revision = model.capture();
 const runner = new SubmissionRunner();
 const attempt = runner.begin(() => model.isCurrent(revision))!;
 let finish!: () => void;
 const pending = attempt.finalize(() => new Promise<void>(resolve => { finish = resolve; }));
 model.observe("second-model");
 finish();
 await assert.rejects(pending, { name: "AbortError" });
 assert.equal(runner.occupied, false);
});
