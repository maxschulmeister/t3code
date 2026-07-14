import { describe, expect, it } from "vite-plus/test";

import {
  applyResolvedColorTheme,
  colorThemeToCssVars,
  clearColorThemeCssVars,
  MANAGED_COLOR_THEME_CSS_VARS,
} from "./applyColorTheme";
import { BUILTIN_COLOR_THEMES } from "./builtinThemes";

function createStyleRoot(): HTMLElement {
  const store = new Map<string, string>();
  return {
    style: {
      setProperty: (key: string, value: string) => {
        store.set(key, value);
      },
      removeProperty: (key: string) => {
        store.delete(key);
      },
      getPropertyValue: (key: string) => store.get(key) ?? "",
    },
  } as unknown as HTMLElement;
}

describe("colorThemeToCssVars", () => {
  it("maps semantic tokens and ansi palette to CSS vars", () => {
    const theme = BUILTIN_COLOR_THEMES[0]!;
    const vars = colorThemeToCssVars(theme);
    expect(vars["--background"]).toBe(theme.background);
    expect(vars["--primary"]).toBe(theme.primary);
    expect(vars["--ansi-blue"]).toBe(theme.ansi.blue);
    expect(vars["--terminal-cursor"]).toBe(theme.cursor);
    expect(vars["--app-chrome-background"]).toBe(theme.background);
  });

  it("applies font overrides when provided", () => {
    const theme = BUILTIN_COLOR_THEMES[0]!;
    const vars = colorThemeToCssVars(theme, {
      uiFontFamily: "Inter",
      uiFontSizePx: 15,
    });
    expect(vars["--font-sans"]).toBe("Inter");
    expect(vars["--app-font-size"]).toBe("15px");
  });
});

describe("applyResolvedColorTheme", () => {
  it("writes and clears managed CSS vars on a root element", () => {
    const root = createStyleRoot();
    const theme = BUILTIN_COLOR_THEMES[0]!;
    applyResolvedColorTheme({ theme, root });
    expect(root.style.getPropertyValue("--background")).toBe(theme.background);
    clearColorThemeCssVars(root);
    for (const cssVar of MANAGED_COLOR_THEME_CSS_VARS) {
      expect(root.style.getPropertyValue(cssVar)).toBe("");
    }
  });
});
