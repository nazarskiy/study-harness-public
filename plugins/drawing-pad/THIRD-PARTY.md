# Attribution and licenses

## Handwriting contribution (adapted mechanics)

Pressure-sensitive strokes, whole-stroke segment-distance erasing, undo history,
mouse/stylus pointer handling, and frozen background composition are adapted from:

- Branch: `codex/handwriting-contribution`
- Reviewed commit: `48dd022`
- Files: `src/core/question-writing.ts`, `components/question-writing.tsx`,
  `components/question-writing-capture.ts`
- License: AGPL-3.0-only.

This is plugin-owned code using public host capabilities, not a copy of the
contribution's private native UI integration. The plugin adds per-session lifetime,
settings, submission interception, and practice-specific acceptance/reset behavior.

## html-to-image 1.11.13

https://github.com/bubkoo/html-to-image

MIT licensed. Bundled solely to capture plugin-owned rendered reference DOM; the
package license is copied to `dist/licenses/html-to-image-LICENSE` during build.

## Tabler Icons

Rounded outline icons from Tabler Icons 3.51.0 (https://github.com/tabler/tabler-icons), licensed under MIT. See [the license](licenses/tabler-icons-LICENSE.txt).
