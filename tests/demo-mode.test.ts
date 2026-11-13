import type { AgentMessage,AgentTool } from "@earendil-works/pi-agent-core";
import assert from "node:assert/strict";
import { test } from "node:test";
import { Type } from "typebox";
import { createDemoQuestionGuard } from "../src/agent/demo-mode.ts";
import type { PiEngine } from "../src/agent/models.ts";
import { createPracticeAgent,createProberAgent,createTeacherAgent } from "../src/agent/teacher-agent.ts";
import { invalidInputResult,questionResult } from "../src/agent/tool-execute.ts";
import type { PlanTree } from "../src/core/contracts.ts";
import { countDemoQuestions,DEMO_QUESTION_LIMIT,demoModeEnabled } from "../src/core/demo-mode.ts";
import { readPluginQuestionMessageAnnotation } from "../src/core/plugin-questions.ts";
import type { ChatStore } from "../src/core/ports.ts";

const quiz = { question: "2 + 2?", options: [{ label: "4", value: "four" }, { label: "5", value: "five" }], correctAnswer: "four", explanation: "Addition" };
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
function question(id: string, name = "probe", args: unknown = quiz): AgentMessage {
	return { id: `assistant-${id}`, role: "assistant", content: [{ type: "toolCall", id, name, arguments: args }], api: "openai-responses", provider: "offline", model: "offline", usage, stopReason: "toolUse", timestamp: 1 } as AgentMessage;
}
function result(id: string, isError = false): AgentMessage {
	return { id: `result-${id}`, role: "toolResult", toolCallId: id, toolName: "probe", content: [{ type: "text", text: "Answer" }], details: { dismissed: !isError }, isError, timestamp: 2 } as AgentMessage;
}
function pluginQuestion(id: string): AgentMessage {
	const message = question(id, "plugin_question", { question: "Custom question", payload: {} });
	return { ...message, owllyQuestions: { "0": { protocolVersion: 1, pluginId: "demo-plugin", typeId: "demo-question", label: "Demo question", variant: "probe", questionId: id,
		occurrence: { messageId: `assistant-${id}`, contentIndex: 0, toolCallId: id, toolName: "plugin_question" }, contractVersion: 1, input: { question: "Custom question", payload: {} },
		questionSchema: Type.Object({}), answerSchema: Type.String(), showThinking: false, requiresAnswerRefinement: false } } } as unknown as AgentMessage;
}
const four = [question("one"), question("two"), question("three"), question("four")];
const tool = (name: string, execute: AgentTool<any>["execute"] = async () => questionResult()): AgentTool<any> => ({ name, label: name, description: name, parameters: Type.Object({}), execute });
const engine: PiEngine = {
	model: { id: "offline", name: "Offline", provider: "offline", api: "openai-responses", baseUrl: "https://offline.invalid", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 10000, maxTokens: 1000 },
	streamFn: () => { throw new Error("These tests must not call a model provider"); },
};

test("counts saved probing history, including clarification, custom questions and skipped answers", () => {
	const custom = pluginQuestion("custom");
	assert.equal(readPluginQuestionMessageAnnotation(custom, 0).status, "posed");
	const history = [question("one"), result("one"), question("two"), result("two"), custom, question("four", "quiz", { type: "check", nodeId: "math", ...quiz })];
	assert.equal(countDemoQuestions(history), DEMO_QUESTION_LIMIT);
	assert.equal(countDemoQuestions([...history, { role: "custom", customType: "compaction", content: "A short summary", details: {}, timestamp: 3 } as AgentMessage]), 4);
	assert.equal(countDemoQuestions([...history, custom]), 4);
	assert.equal(countDemoQuestions([question("bad"), result("bad", true), question("valid")]), 1);
	assert.equal(countDemoQuestions([question("malformed", "probe", {}), { ...question("aborted"), stopReason: "aborted" } as AgentMessage]), 0);
	assert.equal(countDemoQuestions([question("reused"), result("reused", true), { ...question("reused"), id: "another-message" } as AgentMessage]), 1);
	const legacy = { ...custom, owllyQuestions: { "0": { questionId: "legacy-question", protocolVersion: 999 } } } as unknown as AgentMessage;
	assert.equal(countDemoQuestions([legacy]), 1);
});

test("hard cap covers built-in probing questions and hides them when reached", async () => {
	let executions = 0;
	const tools = [tool("probe", async () => { executions++; return questionResult(); }), tool("quiz"), tool("read"), tool("probe_done")];
	const guard = createDemoQuestionGuard([question("one"), question("two")]);
	const wrapped = guard.wrapTools(tools);
	await wrapped.find(item => item.name === "probe")!.execute("third", {});
	await wrapped.find(item => item.name === "quiz")!.execute("fourth", {});
	const refused = await wrapped.find(item => item.name === "probe")!.execute("fifth", {});
	assert.equal(refused.isError, true); assert.equal(executions, 1); assert.equal(guard.count(), 4);
	assert.deepEqual(guard.availableTools(wrapped).map(item => item.name), ["read", "probe_done"]);
	assert.match(guard.instructions(), /limit has been reached/);
	assert.equal(createDemoQuestionGuard(four).count(), 4);
});

test("invalid/failed attempts do not spend questions; concurrent calls cannot exceed four", async () => {
	const guard = createDemoQuestionGuard(four.slice(0, 3));
	const failed = guard.wrapTools([tool("quiz", async () => invalidInputResult("quiz", ["Invalid"]))])[0]!;
	await failed.execute("invalid", {}); assert.equal(guard.count(), 3);
	const throwing = guard.wrapTools([tool("quiz", async () => { throw new Error("Failure"); })])[0]!;
	await assert.rejects(throwing.execute("error", {}), /Failure/); assert.equal(guard.count(), 3);
	let release!: () => void;
	const wait = new Promise<void>(resolve => { release = resolve; });
	let executions = 0;
	const wrapped = guard.wrapTools([tool("quiz", async () => { executions++; await wait; return questionResult(); })])[0]!;
	const fourth = wrapped.execute("fourth", {});
	const fifth = await wrapped.execute("fifth", {}); assert.equal(fifth.isError, true);
	release(); await fourth; assert.equal(executions, 1); assert.equal(guard.count(), 4);
});

test("only probing is capped; teaching, graph planning, Challenge and disabled mode remain unchanged", async () => {
	assert.equal(demoModeEnabled({}), false); assert.equal(demoModeEnabled({ OWLLY_DEMO_MODE: "0" }), false); assert.equal(demoModeEnabled({ OWLLY_DEMO_MODE: "1" }), true);
	const teacher = createTeacherAgent(undefined, { engine, messages: four, demoMode: true });
	assert.ok(teacher.state.tools.some(item => item.name === "quiz"));
	assert.ok(teacher.state.tools.some(item => item.name === "ask_user_question"));
	assert.doesNotMatch(teacher.state.systemPrompt, /## Demo mode/);
	assert.match(teacher.state.systemPrompt, /plan_init/);
	const prober = createProberAgent({ chatId: "demo", chatStore: {} as never, jobStore: {} as never, deliver: () => {}, spawn: () => {} }, { engine, messages: four, demoMode: true });
	assert.ok(!prober.state.tools.some(item => item.name === "probe" || item.name === "ask_user_question"));
	assert.ok(prober.state.tools.some(item => item.name === "probe_done"));
	assert.match(prober.state.systemPrompt, /Call probe_done now/);
	assert.match(prober.state.systemPrompt, /do not teach or wrap up the lesson yourself/);
	const earlyProber = createProberAgent({ chatId: "demo", chatStore: {} as never, jobStore: {} as never, deliver: () => {}, spawn: () => {} }, { engine, messages: four.slice(0, 3), demoMode: true });
	assert.ok(earlyProber.state.tools.some(item => item.name === "probe"));
	assert.match(earlyProber.state.systemPrompt, /even before the limit, call probe_done/);
	const normal = createTeacherAgent(undefined, { engine, messages: four, demoMode: false });
	assert.ok(normal.state.tools.some(item => item.name === "quiz")); assert.doesNotMatch(normal.state.systemPrompt, /## Demo mode/);
	const practice = createPracticeAgent(undefined as never, { engine, messages: four, demoMode: true, tools: { quiz: tool("quiz") } });
	assert.ok(practice.state.tools.some(item => item.name === "quiz")); assert.doesNotMatch(practice.state.systemPrompt, /## Demo mode/);
	const previous = process.env.OWLLY_DEMO_MODE;
	try {
		process.env.OWLLY_DEMO_MODE = "1";
		assert.doesNotMatch(createTeacherAgent(undefined, { engine }).state.systemPrompt, /## Demo mode/);
		assert.match(createProberAgent({ chatId: "demo", chatStore: {} as never, jobStore: {} as never, deliver: () => {}, spawn: () => {} }, { engine }).state.systemPrompt, /## Demo mode/);
	}
	finally { if (previous === undefined) delete process.env.OWLLY_DEMO_MODE; else process.env.OWLLY_DEMO_MODE = previous; }
});

test("four answered probes can hand off, create the graph and ask more than four teaching questions", async () => {
	let tree: PlanTree | undefined;
	const history = four.flatMap((message, index) => [message, result(["one", "two", "three", "four"][index]!)]);
	const chatStore = {
		getChat: () => ({ id: "demo", messages: history, tree }),
		saveTree: (_id: string, next: PlanTree) => { tree = next; },
	} as unknown as ChatStore;
	const delivered: unknown[] = [];
	const context = { chatId: "demo", chatStore, jobStore: {} as never, deliver: (message: unknown) => { delivered.push(message); }, spawn: () => {} };
	const prober = createProberAgent(context, { engine, messages: history, demoMode: true });
	const acknowledgment = await prober.state.tools.find(item => item.name === "probe_done")!.execute("done", {
		assessment: { strands: [{ strand: "Docker basics", assessment: "No reliable knowledge floor established; begin with images and containers." }] },
	});
	assert.deepEqual(acknowledgment.details, { ok: true });
	assert.equal(delivered.length, 1);
	const teacher = createTeacherAgent(context, { engine, messages: history, demoMode: true });
	await teacher.state.tools.find(item => item.name === "plan_init")!.execute("plan", {
		mermaid: "graph TD\n  images[Docker images]\n  containers[Running containers]\n  images --> containers",
	});
	assert.deepEqual(tree?.nodes.map(node => node.id), ["images", "containers"]);
	const check = teacher.state.tools.find(item => item.name === "quiz")!;
	for (let index = 0; index < 5; index++) {
		const asked = await check.execute(`teaching-${index}`, { ...quiz, nodeId: "containers", type: "check" });
		assert.notEqual(asked.isError, true);
		assert.equal(asked.terminate, true);
	}
});
