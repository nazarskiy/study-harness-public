import type { Static,TSchema } from "typebox";
import { copyImmutableData,ImmutableReadCache } from "./immutable-data.ts";
import type { OwllyMessage } from "./native-messages.ts";
import {
clonePluginQuestionJson,
createPluginQuestionParameters,
freezePluginQuestionValue,
preparePluginQuestionSchema,
preparePluginQuestionType,
type JsonValue,type PluginQuestionOccurrence,type PluginQuestionValidationResult,
} from "./plugin-questions.ts";
import { preparePluginProblemSubmissionImages,type PluginProblemSubmissionImages } from "./plugin-submissions.ts";
import { checkPluginSchema,preparePluginSchema } from "./plugin-validation.ts";
import { practiceProblemInputSchema } from "./practice-problems.ts";

export interface PluginProblemInput<Q = JsonValue> {
  statement: string;
  mode: "recall" | "discrimination" | "composition";
  target?: string[];
  modelSolution: string;
  payload: Q;
}
export interface PluginProblemValidationContext<Q = JsonValue> {
  readonly chatId: string;
  readonly contractVersion: number;
  readonly input: PluginProblemInput<Q>;
}
export interface PluginProblemSubmissionValidationContext<Q = JsonValue, S = JsonValue> extends PluginProblemValidationContext<Q> {
  readonly problemId: string;
  readonly submission: S;
}
export interface PluginProblemProcessingContext<Q = JsonValue, S = JsonValue> extends PluginProblemSubmissionValidationContext<Q, S> {
  readonly thinking: string;
  readonly images?: PluginProblemSubmissionImages;
  readonly signal: AbortSignal;
}
export type PluginProblemProcessingOutcome = { result: JsonValue } | { error: string };
export interface PluginProblemTypeDefinition<Q extends TSchema = TSchema, S extends TSchema = TSchema> {
  id: string;
  label: string;
  contractVersion: number;
  incompatibleContractVersions?: number[];
  tool: { toolName: string; description: string };
  problemSchema: Q;
  submissionSchema: S;
  validateProblem?: (context: PluginProblemValidationContext<Static<Q>>) => undefined | string[];
  validateSubmission?: (context: PluginProblemSubmissionValidationContext<Static<Q>, Static<S>>) => undefined | string[];
  processSubmission?: (context: PluginProblemProcessingContext<Static<Q>, Static<S>>) => JsonValue | Promise<JsonValue>;
}
export interface PluginProblemSnapshot {
  protocolVersion: 1;
  problemId: string;
  pluginId: string;
  typeId: string;
  label: string;
  contractVersion: number;
  input: PluginProblemInput;
  problemSchema: TSchema;
  submissionSchema: TSchema;
  requiresSubmissionRefinement: boolean;
  requiresProcessing: boolean;
}
export interface PluginProblemSubmission {
  kind: "plugin-problem-submission";
  problemId: string;
  pluginId: string;
  typeId: string;
  contractVersion: number;
  submission: JsonValue;
  thinking: string;
  images?: PluginProblemSubmissionImages;
  processing?: PluginProblemProcessingOutcome;
  submittedAt: string;
}
function questionAdapter(definition: PluginProblemTypeDefinition) {
  return { id: definition.id, label: definition.label, contractVersion: definition.contractVersion,
    incompatibleContractVersions: definition.incompatibleContractVersions, showThinking: true,
    probe: definition.tool, questionSchema: definition.problemSchema, answerSchema: definition.submissionSchema,
    validateQuestion: definition.validateProblem as never, validateAnswer: definition.validateSubmission as never,
    gradeAnswer: definition.processSubmission as never };
}
export function preparePluginProblemType<Q extends TSchema, S extends TSchema>(definition: PluginProblemTypeDefinition<Q, S>): PluginProblemTypeDefinition<Q, S> {
  const prepared = preparePluginQuestionType(questionAdapter(definition));
  return freezePluginQuestionValue({ id: prepared.id, label: prepared.label, contractVersion: prepared.contractVersion,
    ...(prepared.incompatibleContractVersions ? { incompatibleContractVersions: prepared.incompatibleContractVersions } : {}),
    tool: prepared.probe!, problemSchema: prepared.questionSchema as Q, submissionSchema: prepared.answerSchema as S,
    ...(definition.validateProblem ? { validateProblem: definition.validateProblem } : {}),
    ...(definition.validateSubmission ? { validateSubmission: definition.validateSubmission } : {}),
    ...(definition.processSubmission ? { processSubmission: definition.processSubmission } : {}) });
}
const parameters = new ImmutableReadCache<TSchema>();
export function createPluginProblemParameters(definition: PluginProblemTypeDefinition): TSchema {
  const base = createPluginQuestionParameters(questionAdapter(definition), "probe") as TSchema & { properties: Record<string, TSchema> };
  return parameters.read(base, undefined, () => buildProblemParameters(base));
}
function buildProblemParameters(base: TSchema & { properties: Record<string, TSchema> }): TSchema {
  const common = preparePluginQuestionSchema(practiceProblemInputSchema) as TSchema & { properties: Record<string, TSchema>; required: string[] };
  const prepared = copyImmutableData({ ...common, additionalProperties: false,
    properties: { ...common.properties, payload: base.properties.payload }, required: [...common.required, "payload"] }) as TSchema;
  preparePluginSchema(prepared);
  return prepared;
}
function refinement(callback: ((context: never) => unknown) | undefined, context: unknown): string[] {
  if (!callback) return [];
  try {
    const result = callback(freezePluginQuestionValue(context) as never);
    if (result === undefined) return [];
    if (result && typeof (result as { then?: unknown }).then === "function") {
      void Promise.resolve(result).catch(() => {});
      return ["Problem validation must be synchronous."];
    }
    return Array.isArray(result) && result.every(item => typeof item === "string" && item.trim()) ? result : ["Problem validation must return readable problems or undefined."];
  } catch { return ["Problem validation failed."]; }
}
const failed = <T>(message: string): PluginQuestionValidationResult<T> => ({ ok: false, problems: [message] });
export function validatePluginProblemInput(definition: PluginProblemTypeDefinition, context: { chatId: string; input: unknown }): PluginQuestionValidationResult<PluginProblemInput> {
  try {
    const input = freezePluginQuestionValue(clonePluginQuestionJson(context.input)) as unknown as PluginProblemInput;
    if (!checkPluginSchema(createPluginProblemParameters(definition), input)) return failed("Problem does not satisfy its input contract.");
    const errors = refinement(definition.validateProblem as never, { chatId: context.chatId, contractVersion: definition.contractVersion, input });
    return errors.length ? { ok: false, problems: errors } : { ok: true, value: input };
  } catch { return failed("Problem must be finite JSON satisfying its input contract."); }
}
const snapshots = new ImmutableReadCache<PluginProblemSnapshot | null>();
export function readPluginProblemSnapshot(value: unknown): PluginProblemSnapshot | null {
  const saved = snapshots.read(value, undefined, () => readProblemSnapshot(value));
  if (saved) snapshots.seed(saved, undefined, saved);
  return saved;
}
function readProblemSnapshot(value: unknown): PluginProblemSnapshot | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) return null;
    const fields: Record<string, unknown> = {};
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== "string") return null;
      const descriptor = descriptors[key]!;
      if (!descriptor.enumerable || !("value" in descriptor)) return null;
      Object.defineProperty(fields, key, { enumerable: true, value: key === "problemSchema" || key === "submissionSchema"
        ? preparePluginQuestionSchema(descriptor.value) : descriptor.value });
    }
    const copy = clonePluginQuestionJson(fields) as unknown as PluginProblemSnapshot;
    copy.problemSchema = fields.problemSchema as TSchema;
    copy.submissionSchema = fields.submissionSchema as TSchema;
    if (!copy || copy.protocolVersion !== 1 || typeof copy.problemId !== "string" || !copy.problemId.trim() ||
      typeof copy.pluginId !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(copy.pluginId) ||
      typeof copy.requiresSubmissionRefinement !== "boolean" || typeof copy.requiresProcessing !== "boolean") return null;
    const definition = preparePluginProblemType({ id: copy.typeId, label: copy.label, contractVersion: copy.contractVersion,
      tool: { toolName: "saved_problem", description: "Saved problem" }, problemSchema: copy.problemSchema, submissionSchema: copy.submissionSchema });
    const accepted = validatePluginProblemInput(definition, { chatId: "", input: copy.input });
    if (!accepted.ok) return null;
    return copyImmutableData({ protocolVersion: 1, problemId: copy.problemId, pluginId: copy.pluginId,
      typeId: definition.id, label: definition.label, contractVersion: definition.contractVersion, input: accepted.value,
      problemSchema: definition.problemSchema, submissionSchema: definition.submissionSchema,
      requiresSubmissionRefinement: copy.requiresSubmissionRefinement, requiresProcessing: copy.requiresProcessing });
  } catch { return null; }
}

const submissions = new ImmutableReadCache<PluginProblemSubmission | null>();
export function readPluginProblemSubmission(value: unknown): PluginProblemSubmission | null {
  return submissions.read(value, undefined, () => readProblemSubmission(value));
}
function readProblemSubmission(value: unknown): PluginProblemSubmission | null {
  try {
    const copy = clonePluginQuestionJson(value) as unknown as PluginProblemSubmission;
    if (!copy || copy.kind !== "plugin-problem-submission" || typeof copy.problemId !== "string" || !copy.problemId ||
      typeof copy.pluginId !== "string" || typeof copy.typeId !== "string" || !Number.isSafeInteger(copy.contractVersion) || copy.contractVersion < 1 ||
      !Object.hasOwn(copy, "submission") || typeof copy.thinking !== "string" || typeof copy.submittedAt !== "string") return null;
    if (copy.images !== undefined) copy.images = preparePluginProblemSubmissionImages(copy.images);
    if (copy.processing !== undefined) {
      const outcome = copy.processing;
      if (!outcome || typeof outcome !== "object" || Array.isArray(outcome) || Object.keys(outcome).length !== 1 ||
        !(Object.hasOwn(outcome, "result") || (Object.hasOwn(outcome, "error") && typeof (outcome as { error: unknown }).error === "string"))) return null;
    }
    return freezePluginQuestionValue(copy);
  } catch { return null; }
}

export function pluginProblemById(messages: readonly OwllyMessage[], problemId: string): PluginProblemSnapshot | null {
  for (const message of messages) if (message.role === "assistant") for (const [contentIndex, call] of message.content.entries()) {
    if (call.type !== "toolCall") continue;
    const snapshot = pluginProblemForCall(messages, { messageId: message.id, contentIndex, toolCallId: call.id, toolName: call.name });
    if (snapshot?.problemId === problemId) return snapshot;
  }
  return null;
}

export function pluginProblemForCall(messages: readonly OwllyMessage[], occurrence: PluginQuestionOccurrence): PluginProblemSnapshot | null {
  const mi = messages.findIndex(message => message.id === occurrence.messageId && message.role === "assistant");
  if (mi < 0) return null;
  const owner = messages[mi] as { content: { type: string; id?: string; name?: string }[] };
  const call = owner.content[occurrence.contentIndex];
  if (call?.type !== "toolCall" || call.id !== occurrence.toolCallId || call.name !== occurrence.toolName) return null;
  for (let index = mi + 1; index < messages.length; index++) {
    const result = messages[index] as OwllyMessage & { toolCallId?: string; toolName?: string; isError?: boolean; details?: { pluginProblem?: unknown } };
    if (result.role === "assistant") break;
    if (result.role === "toolResult" && result.toolCallId === call.id && result.toolName === call.name) {
      return result.isError ? null : readPluginProblemSnapshot(result.details?.pluginProblem);
    }
  }
  return null;
}
