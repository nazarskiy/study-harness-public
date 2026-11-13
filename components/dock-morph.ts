const DURATION = 120;
const EASING = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const EPSILON = 1;

export function naturalDockHeight(shell: HTMLElement) {
	const value = shell.style.getPropertyValue("height");
	const priority = shell.style.getPropertyPriority("height");
	try {
		shell.style.setProperty("height", "auto", "important");
		return shell.getBoundingClientRect().height;
	} finally {
		if (value) shell.style.setProperty("height", value, priority);
		else shell.style.removeProperty("height");
	}
}

export function createDockMorph() {
	let previous: { shell: HTMLElement; key: string; height: number } | null = null;
	let owned: {
		shell: HTMLElement; key: string; animation: Animation; opening: boolean;
		target: number; duration: number;
	} | null = null;
	const live = (animation: Animation) => animation.playState !== "finished" && animation.playState !== "idle";
	const cancel = () => {
		owned?.animation.cancel();
		owned = null;
	};
	return {
		layout(shell: HTMLElement, key: string, opening: boolean, onNaturalLayout: () => void) {
			if (previous?.shell === shell && previous.key === key) {
				if (owned && live(owned.animation)) return;
				previous.height = shell.getBoundingClientRect().height;
				onNaturalLayout();
				return;
			}
			cancel();
			const height = shell.getBoundingClientRect().height;
			onNaturalLayout();
			if (previous?.shell === shell && Math.abs(previous.height - height) > EPSILON) {
				const animation = shell.animate([
					{ height: `${previous.height}px` }, { height: `${height}px` },
				], { duration: DURATION, easing: EASING });
				owned = { shell, key, animation, opening, target: height, duration: DURATION };
			}
			previous = { shell, key, height };
		},
		retarget(key: string) {
			const active = owned;
			if (!active || active.key !== key || !active.opening || !live(active.animation)) return;
			const effect = active.animation.effect as KeyframeEffect | null;
			if (!effect) return;
			const visible = active.shell.getBoundingClientRect().height;
			const currentTime = active.animation.currentTime;
			const remaining = active.duration - (typeof currentTime === "number" ? currentTime : 0);
			if (remaining <= 0) return;
			const target = naturalDockHeight(active.shell);
			if (Math.abs(target - active.target) <= EPSILON || !live(active.animation)) return;
			active.animation.currentTime = 0;
			effect.setKeyframes([{ height: `${visible}px` }, { height: `${target}px` }]);
			effect.updateTiming({ duration: remaining });
			active.duration = remaining;
			active.target = target;
			if (previous?.key === key) previous.height = target;
		},
		dispose() {
			cancel();
			previous = null;
		},
	};
}
