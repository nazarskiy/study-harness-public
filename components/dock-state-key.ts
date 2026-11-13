export function dockStateKey(mode: string, docked: boolean, expanded: boolean): string {
	return docked ? `${mode}:${expanded}` : `${mode}:-`;
}
