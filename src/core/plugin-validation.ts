import type { TSchema } from "typebox";
import { Compile } from "typebox/compile";
import { copyImmutableData,ImmutableReadCache } from "./immutable-data.ts";

const types = new Set([
	"object", "array", "boolean", "integer", "number", "null", "string",
	"bigint", "constructor", "function", "symbol", "undefined", "void",
]);
const maps = new Set(["properties", "patternProperties", "$defs", "definitions", "dependentSchemas"]);
const lists = new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);
const nested = new Set([
	"additionalProperties", "additionalItems", "unevaluatedProperties", "unevaluatedItems",
	"contains", "propertyNames", "not", "if", "then", "else", "contentSchema",
]);
const numeric = new Set([
	"minimum", "maximum", "multipleOf", "minLength", "maxLength", "minItems", "maxItems",
	"minProperties", "maxProperties", "minContains", "maxContains",
]);
const references = new Set(["$ref", "$recursiveRef", "$dynamicRef"]);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string");

export function validatePluginSchema(schema: unknown) {
	const seen = new WeakSet<object>();
	function fail(location: string): never { throw new Error(`Malformed native schema at ${location}`); }
	function visit(value: unknown, location: string): void {
		if (typeof value === "boolean") return;
		if (!object(value)) fail(location);
		if (seen.has(value)) return;
		seen.add(value);
		for (const [key, child] of Object.entries(value)) {
			const at = `${location}.${key}`;
			if (key === "type") {
				const valid = (name: unknown) => typeof name === "string" && types.has(name);
				if (!(valid(child) || (Array.isArray(child) && child.length > 0 && child.every(valid)))) fail(at);
			} else if (maps.has(key) || key === "dependencies" || key === "dependentRequired") {
				if (!object(child)) fail(at);
				for (const [name, entry] of Object.entries(child)) {
					if (key === "dependentRequired") { if (!strings(entry)) fail(`${at}.${name}`); }
					else if (key === "dependencies" && strings(entry)) continue;
					else visit(entry, `${at}.${name}`);
				}
			} else if (lists.has(key) || (key === "items" && Array.isArray(child)) ||
				(key === "parameters" && (value.type === "function" || value.type === "constructor"))) {
				if (!Array.isArray(child)) fail(at);
				child.forEach((entry, index) => visit(entry, `${at}[${index}]`));
			} else if (nested.has(key) || key === "items" ||
				(key === "returnType" && value.type === "function") || (key === "instanceType" && value.type === "constructor")) visit(child, at);
			else if (references.has(key) || key === "format") { if (typeof child !== "string") fail(at); }
			else if (key === "pattern") { if (typeof child !== "string" && !(child instanceof RegExp)) fail(at); }
			else if (key === "required") { if (typeof child !== "boolean" && !strings(child)) fail(at); }
			else if (key === "enum") { if (!Array.isArray(child)) fail(at); }
			else if (key === "uniqueItems") { if (typeof child !== "boolean") fail(at); }
			else if (numeric.has(key)) { if (typeof child !== "number" && typeof child !== "bigint") fail(at); }
			else if (key === "exclusiveMinimum" || key === "exclusiveMaximum") {
				if (!["boolean", "number", "bigint"].includes(typeof child)) fail(at);
			}
		}
	}
	visit(schema, "$");
	return Compile(schema as TSchema);
}

const preparedChecks = new ImmutableReadCache<(value: unknown) => boolean>();
const booleanSchemas = copyImmutableData({ true: { schema: true }, false: { schema: false } });
function preparedCheck(schema: unknown): (value: unknown) => boolean {
	const key = typeof schema === "boolean" ? booleanSchemas[String(schema) as "true" | "false"] : schema;
	return preparedChecks.read(key, undefined, () => {
		const validator = validatePluginSchema(schema);
		return value => validator.Check(value);
	});
}
export function preparePluginSchema(schema: unknown): void { preparedCheck(schema); }
export function checkPluginSchema(schema: unknown, value: unknown): boolean { return preparedCheck(schema)(value); }
