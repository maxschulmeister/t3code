import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ModelSelection } from "./orchestration.ts";

/**
 * CSS color string for theme tokens.
 * Prefer `#RRGGBB` / `#RRGGBBAA`; also accepts `rgb()`, `rgba()`, `hsl()`, `hsla()`, `oklch()`.
 */
export const CssColor = TrimmedNonEmptyString.check(
  Schema.isMaxLength(128),
  Schema.isPattern(
    /^(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\)|oklch\([^)]+\)|[a-zA-Z][a-zA-Z0-9-]*)$/,
  ),
);
export type CssColor = typeof CssColor.Type;

export const ColorThemeAppearance = Schema.Literals(["light", "dark"]);
export type ColorThemeAppearance = typeof ColorThemeAppearance.Type;

export const AnsiPalette = Schema.Struct({
  black: CssColor,
  red: CssColor,
  green: CssColor,
  yellow: CssColor,
  blue: CssColor,
  magenta: CssColor,
  cyan: CssColor,
  white: CssColor,
  brightBlack: CssColor,
  brightRed: CssColor,
  brightGreen: CssColor,
  brightYellow: CssColor,
  brightBlue: CssColor,
  brightMagenta: CssColor,
  brightCyan: CssColor,
  brightWhite: CssColor,
});
export type AnsiPalette = typeof AnsiPalette.Type;

/**
 * Full app color theme. Maps 1:1 onto semantic CSS custom properties in
 * `apps/web/src/index.css` plus the xterm ANSI palette.
 *
 * This is the structured-output schema for LLM theme generation and the
 * persisted shape for custom themes.
 */
export const ColorThemeTokens = Schema.Struct({
  name: TrimmedNonEmptyString,
  appearance: ColorThemeAppearance,
  background: CssColor,
  foreground: CssColor,
  card: CssColor,
  cardForeground: CssColor,
  popover: CssColor,
  popoverForeground: CssColor,
  primary: CssColor,
  primaryForeground: CssColor,
  secondary: CssColor,
  secondaryForeground: CssColor,
  muted: CssColor,
  mutedForeground: CssColor,
  accent: CssColor,
  accentForeground: CssColor,
  destructive: CssColor,
  destructiveForeground: CssColor,
  border: CssColor,
  input: CssColor,
  ring: CssColor,
  info: CssColor,
  infoForeground: CssColor,
  success: CssColor,
  successForeground: CssColor,
  warning: CssColor,
  warningForeground: CssColor,
  cursor: CssColor,
  selectionBackground: CssColor,
  ansi: AnsiPalette,
  fontSans: Schema.optionalKey(TrimmedNonEmptyString),
  fontMono: Schema.optionalKey(TrimmedNonEmptyString),
  fontSizePx: Schema.optionalKey(
    Schema.Number.check(Schema.isBetween({ minimum: 10, maximum: 24 })),
  ),
});
export type ColorThemeTokens = typeof ColorThemeTokens.Type;

/** LLM structured-output shape (no id; server assigns one on save). */
export const GeneratedColorTheme = ColorThemeTokens;
export type GeneratedColorTheme = typeof GeneratedColorTheme.Type;

export const ColorThemeId = TrimmedNonEmptyString.pipe(Schema.brand("ColorThemeId"));
export type ColorThemeId = typeof ColorThemeId.Type;

export const BUILTIN_DEFAULT_THEME_ID = ColorThemeId.make("builtin:t3-default");

export const StoredColorTheme = Schema.Struct({
  id: ColorThemeId,
  ...ColorThemeTokens.fields,
  sourcePrompt: Schema.optionalKey(TrimmedNonEmptyString),
  createdAt: Schema.optionalKey(Schema.String),
});
export type StoredColorTheme = typeof StoredColorTheme.Type;

export const MIN_UI_FONT_SIZE_PX = 12;
export const MAX_UI_FONT_SIZE_PX = 20;
export const DEFAULT_UI_FONT_SIZE_PX = 16;

export const UiFontSizePx = Schema.Number.check(
  Schema.isBetween({ minimum: MIN_UI_FONT_SIZE_PX, maximum: MAX_UI_FONT_SIZE_PX }),
);
export type UiFontSizePx = typeof UiFontSizePx.Type;

export const GenerateColorThemeInput = Schema.Struct({
  prompt: TrimmedNonEmptyString.check(Schema.isMaxLength(32_000)),
  modelSelection: ModelSelection,
  /** Preferred appearance hint; model may still choose based on prompt. */
  preferredAppearance: Schema.optionalKey(ColorThemeAppearance),
});
export type GenerateColorThemeInput = typeof GenerateColorThemeInput.Type;

export const GenerateColorThemeResult = Schema.Struct({
  theme: GeneratedColorTheme,
});
export type GenerateColorThemeResult = typeof GenerateColorThemeResult.Type;

export const decodeGeneratedColorTheme = Schema.decodeUnknownEffect(GeneratedColorTheme);
export const decodeStoredColorTheme = Schema.decodeUnknownEffect(StoredColorTheme);

export const makeStoredColorTheme = (input: {
  readonly id: ColorThemeId;
  readonly theme: GeneratedColorTheme;
  readonly sourcePrompt?: string | undefined;
  readonly createdAt?: string | undefined;
}): StoredColorTheme => ({
  id: input.id,
  ...input.theme,
  ...(input.sourcePrompt !== undefined ? { sourcePrompt: input.sourcePrompt } : {}),
  ...(input.createdAt !== undefined ? { createdAt: input.createdAt } : {}),
});

/** Semantic CSS custom property names written when applying a ColorTheme. */
export const COLOR_THEME_CSS_VAR_MAP = {
  background: "--background",
  foreground: "--foreground",
  card: "--card",
  cardForeground: "--card-foreground",
  popover: "--popover",
  popoverForeground: "--popover-foreground",
  primary: "--primary",
  primaryForeground: "--primary-foreground",
  secondary: "--secondary",
  secondaryForeground: "--secondary-foreground",
  muted: "--muted",
  mutedForeground: "--muted-foreground",
  accent: "--accent",
  accentForeground: "--accent-foreground",
  destructive: "--destructive",
  destructiveForeground: "--destructive-foreground",
  border: "--border",
  input: "--input",
  ring: "--ring",
  info: "--info",
  infoForeground: "--info-foreground",
  success: "--success",
  successForeground: "--success-foreground",
  warning: "--warning",
  warningForeground: "--warning-foreground",
} as const satisfies Record<
  keyof Omit<
    ColorThemeTokens,
    | "name"
    | "appearance"
    | "cursor"
    | "selectionBackground"
    | "ansi"
    | "fontSans"
    | "fontMono"
    | "fontSizePx"
  >,
  string
>;

export const ANSI_CSS_VAR_MAP = {
  black: "--ansi-black",
  red: "--ansi-red",
  green: "--ansi-green",
  yellow: "--ansi-yellow",
  blue: "--ansi-blue",
  magenta: "--ansi-magenta",
  cyan: "--ansi-cyan",
  white: "--ansi-white",
  brightBlack: "--ansi-bright-black",
  brightRed: "--ansi-bright-red",
  brightGreen: "--ansi-bright-green",
  brightYellow: "--ansi-bright-yellow",
  brightBlue: "--ansi-bright-blue",
  brightMagenta: "--ansi-bright-magenta",
  brightCyan: "--ansi-bright-cyan",
  brightWhite: "--ansi-bright-white",
} as const satisfies Record<keyof AnsiPalette, string>;

export const COLOR_THEME_META_CSS_VARS = {
  cursor: "--terminal-cursor",
  selectionBackground: "--terminal-selection-background",
  fontSans: "--font-sans",
  fontMono: "--font-mono",
  fontSizePx: "--app-font-size",
} as const;

/** Empty object decode helper used by settings defaults. */
export const emptyCustomColorThemes = Effect.succeed([] as ReadonlyArray<StoredColorTheme>);
