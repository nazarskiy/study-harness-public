
export function stripModelValueDebris(value: string): string {
	return value.replace(/^[\s:."'`]+/, "").replace(/[\s:."'`]+$/, "");
}
