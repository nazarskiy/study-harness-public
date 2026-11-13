# Themes

**Settings → Appearance** picks Owlly's palette:

- **Light** (default): warm cream page, white cards, amber actions, navy accents.
- **Dark**: deep-navy night palette with the same amber and navy roles.
- **System**: follows your operating system's light/dark preference and switches live when it changes.

The choice is stored in the settings record as `appearance.mode`
(`"light" | "dark" | "system"`). **Lesson text size** (`appearance.proseFontSize`,
12–24 px, default 17) scales the teaching prose and inputs.

## Tokens

All colors are CSS variables defined once in `app/globals.css`: `:root`/`.light`
for the light palette and `.dark` for the dark one. Components use the semantic
Tailwind colors built from them (`bg-card`, `text-muted-foreground`, `bg-primary`,
`bg-secondary-soft`, `text-success`, …). Chunky buttons and cards use the
`--*-shade` variables for their bottom lip.

The mascot's colors are separate `--ow-owl-*` variables, so the owl stays on-brand
in both palettes (dark mode only brightens its navy slightly).

Plugins that use the app's CSS variables (`--foreground`, `--border`, `--card`,
`--primary`, `--secondary`, `--success`, `--error`, …) follow the palette
automatically. Mermaid diagrams and the knowledge-graph canvas follow the active
light/dark mode.
