export function sourceFileLabel(filePath: string): string {
	const base = filePath.split(/[\\/]/).pop() || filePath;
	return base.replace(/\.[^.]+$/, "") || base;
}
