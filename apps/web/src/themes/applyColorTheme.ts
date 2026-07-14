import type {
  AnsiPalette,
  ColorThemeId,
  ColorThemeTokens,
  StoredColorTheme,
} from "@t3tools/contracts";
import {
  ANSI_CSS_VAR_MAP,
  BUILTIN_DEFAULT_THEME_ID,
  COLOR_THEME_CSS_VAR_MAP,
  COLOR_THEME_META_CSS_VARS,
} from "@t3tools/contracts";

export const COLOR_THEME_FOUC_STORAGE_KEY = "t3code:color-theme-vars";

const SEMANTIC_KEYS = Object.keys(COLOR_THEME_CSS_VAR_MAP) as Array<
  keyof typeof COLOR_THEME_CSS_VAR_MAP
>;
const ANSI_KEYS = Object.keys(ANSI_CSS_VAR_MAP) as Array<keyof AnsiPalette>;

/** CSS custom properties managed by color themes (cleared when reverting to default). */
export const MANAGED_COLOR_THEME_CSS_VARS: ReadonlyArray<string> = [
  ...Object.values(COLOR_THEME_CSS_VAR_MAP),
  ...Object.values(ANSI_CSS_VAR_MAP),
  COLOR_THEME_META_CSS_VARS.cursor,
  COLOR_THEME_META_CSS_VARS.selectionBackground,
  COLOR_THEME_META_CSS_VARS.fontSans,
  COLOR_THEME_META_CSS_VARS.fontMono,
  COLOR_THEME_META_CSS_VARS.fontSizePx,
  "--app-chrome-background",
];

export type ColorThemeCssVarMap = Record<string, string>;

export function colorThemeToCssVars(
  theme: ColorThemeTokens,
  options?: {
    readonly uiFontFamily?: string | undefined;
    readonly uiFontSizePx?: number | undefined;
  },
): ColorThemeCssVarMap {
  const vars: ColorThemeCssVarMap = {};

  for (const key of SEMANTIC_KEYS) {
    vars[COLOR_THEME_CSS_VAR_MAP[key]] = theme[key];
  }

  for (const key of ANSI_KEYS) {
    vars[ANSI_CSS_VAR_MAP[key]] = theme.ansi[key];
  }

  vars[COLOR_THEME_META_CSS_VARS.cursor] = theme.cursor;
  vars[COLOR_THEME_META_CSS_VARS.selectionBackground] = theme.selectionBackground;
  vars["--app-chrome-background"] = theme.background;

  const fontSans = options?.uiFontFamily?.trim() || theme.fontSans?.trim();
  if (fontSans) {
    vars[COLOR_THEME_META_CSS_VARS.fontSans] = fontSans;
  }

  const fontMono = theme.fontMono?.trim();
  if (fontMono) {
    vars[COLOR_THEME_META_CSS_VARS.fontMono] = fontMono;
  }

  const fontSizePx = options?.uiFontSizePx ?? theme.fontSizePx;
  if (typeof fontSizePx === "number" && Number.isFinite(fontSizePx)) {
    vars[COLOR_THEME_META_CSS_VARS.fontSizePx] = `${fontSizePx}px`;
  }

  return vars;
}

export function clearColorThemeCssVars(root: HTMLElement = document.documentElement): void {
  for (const cssVar of MANAGED_COLOR_THEME_CSS_VARS) {
    root.style.removeProperty(cssVar);
  }
}

export function writeColorThemeCssVars(
  vars: ColorThemeCssVarMap,
  root: HTMLElement = document.documentElement,
): void {
  clearColorThemeCssVars(root);
  for (const [cssVar, value] of Object.entries(vars)) {
    root.style.setProperty(cssVar, value);
  }
}

export function persistColorThemeFoucSnapshot(vars: ColorThemeCssVarMap | null): void {
  if (typeof window === "undefined") return;
  try {
    if (vars === null || Object.keys(vars).length === 0) {
      window.localStorage.removeItem(COLOR_THEME_FOUC_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(COLOR_THEME_FOUC_STORAGE_KEY, JSON.stringify(vars));
  } catch {
    // Ignore quota / private-mode failures; FOUC fallback still works via light/dark.
  }
}

export function readColorThemeFoucSnapshot(): ColorThemeCssVarMap | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(COLOR_THEME_FOUC_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const vars: ColorThemeCssVarMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string" && value.trim().length > 0) {
        vars[key] = value;
      }
    }
    return Object.keys(vars).length > 0 ? vars : null;
  } catch {
    return null;
  }
}

export function isBuiltinDefaultThemeId(themeId: ColorThemeId | string): boolean {
  return themeId === BUILTIN_DEFAULT_THEME_ID;
}

export function resolveStoredOrBuiltinTheme(input: {
  readonly themeId: ColorThemeId | string;
  readonly customThemes: ReadonlyArray<StoredColorTheme>;
  readonly builtinThemes: ReadonlyArray<StoredColorTheme>;
}): StoredColorTheme | null {
  if (isBuiltinDefaultThemeId(input.themeId)) {
    return null;
  }
  return (
    input.customThemes.find((theme) => theme.id === input.themeId) ??
    input.builtinThemes.find((theme) => theme.id === input.themeId) ??
    null
  );
}

export function applyResolvedColorTheme(input: {
  readonly theme: ColorThemeTokens | null;
  readonly uiFontFamily?: string | undefined;
  readonly uiFontSizePx?: number | undefined;
  readonly root?: HTMLElement | undefined;
}): ColorThemeCssVarMap | null {
  const root = input.root ?? (typeof document !== "undefined" ? document.documentElement : null);
  if (!root) return null;

  if (input.theme === null) {
    clearColorThemeCssVars(root);
    // Font size override can still apply without a custom palette.
    if (typeof input.uiFontSizePx === "number" && Number.isFinite(input.uiFontSizePx)) {
      root.style.setProperty(COLOR_THEME_META_CSS_VARS.fontSizePx, `${input.uiFontSizePx}px`);
    }
    const fontFamily = input.uiFontFamily?.trim();
    if (fontFamily) {
      root.style.setProperty(COLOR_THEME_META_CSS_VARS.fontSans, fontFamily);
    }
    persistColorThemeFoucSnapshot(null);
    return null;
  }

  const vars = colorThemeToCssVars(input.theme, {
    uiFontFamily: input.uiFontFamily,
    uiFontSizePx: input.uiFontSizePx,
  });
  writeColorThemeCssVars(vars, root);
  persistColorThemeFoucSnapshot(vars);
  return vars;
}

/** Read ANSI palette from CSS vars (falls back to provided defaults). */
export function readAnsiPaletteFromCss(
  root: HTMLElement = document.documentElement,
  fallback: AnsiPalette,
): AnsiPalette {
  const styles = getComputedStyle(root);
  const read = (key: keyof AnsiPalette): string => {
    const value = styles.getPropertyValue(ANSI_CSS_VAR_MAP[key]).trim();
    return value.length > 0 ? value : fallback[key];
  };
  return {
    black: read("black"),
    red: read("red"),
    green: read("green"),
    yellow: read("yellow"),
    blue: read("blue"),
    magenta: read("magenta"),
    cyan: read("cyan"),
    white: read("white"),
    brightBlack: read("brightBlack"),
    brightRed: read("brightRed"),
    brightGreen: read("brightGreen"),
    brightYellow: read("brightYellow"),
    brightBlue: read("brightBlue"),
    brightMagenta: read("brightMagenta"),
    brightCyan: read("brightCyan"),
    brightWhite: read("brightWhite"),
  };
}
