import { Format } from "typebox/format";
import { Settings } from "typebox/system";

const immutable = new WeakSet<object>();
const container = (value: object) => Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null;
const immutableValue = (value: unknown): boolean => value === null || (typeof value === "object" ? immutable.has(value) : typeof value !== "function");

export function copyImmutableData<T>(value: T): T {
	const copies = new WeakMap<object, object>();
	function copy(item: unknown): unknown {
		if (item === null || typeof item !== "object" || immutable.has(item) || !container(item)) return item;
		const previous = copies.get(item);
		if (previous) return previous;
		const result = Array.isArray(item) ? [] : Object.create(Object.getPrototypeOf(item));
		copies.set(item, result);
		let eligible = true;
		const descriptors = Object.getOwnPropertyDescriptors(item);
		for (const key of Reflect.ownKeys(descriptors)) {
			const descriptor = Reflect.get(descriptors, key) as PropertyDescriptor;
			if ("value" in descriptor) {
				const child = copy(descriptor.value);
				if (!immutableValue(child)) eligible = false;
				Object.defineProperty(result, key, { ...descriptor, value: child });
			} else {
				eligible = false;
				Object.defineProperty(result, key, descriptor);
			}
		}
		Object.freeze(result);
		if (eligible) immutable.add(result);
		return result;
	}
	try { return copy(value) as T; }
	catch { return value; }
}

let formats = Format.Entries();
let settings = Object.entries(Settings.Get());
let epoch = {};
function validationEpoch(): object {
	const nextFormats = Format.Entries(), nextSettings = Object.entries(Settings.Get());
	if (formats.length !== nextFormats.length || formats.some(([key, value], i) => key !== nextFormats[i]![0] || value !== nextFormats[i]![1]) ||
		settings.length !== nextSettings.length || settings.some(([key, value], i) => key !== nextSettings[i]![0] || value !== nextSettings[i]![1])) {
		formats = nextFormats; settings = nextSettings; epoch = {};
	}
	return epoch;
}

export class ImmutableReadCache<T> {
	private entries = new WeakMap<object, { context: unknown; epoch: object; value: T }>();
	read(input: unknown, context: unknown, compute: () => T): T {
		if (input === null || typeof input !== "object" || !immutable.has(input) || !immutableValue(context)) return compute();
		const currentEpoch = validationEpoch(), previous = this.entries.get(input);
		if (previous && previous.context === context && previous.epoch === currentEpoch) return previous.value;
		const value = copyImmutableData(compute());
		this.entries.set(input, { context, epoch: currentEpoch, value });
		return value;
	}
	seed(input: object, context: unknown, value: T): void {
		if (immutable.has(input) && immutableValue(context)) this.entries.set(input, { context, epoch: validationEpoch(), value: copyImmutableData(value) });
	}
}
