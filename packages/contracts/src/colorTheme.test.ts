import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  BUILTIN_DEFAULT_THEME_ID,
  ColorThemeId,
  CssColor,
  GeneratedColorTheme,
  makeStoredColorTheme,
} from "./colorTheme.ts";
import { ClientSettingsSchema } from "./settings.ts";

const decodeCssColor = Schema.decodeUnknownSync(CssColor);
const decodeGenerated = Schema.decodeUnknownSync(GeneratedColorTheme);
const decodeClientSettings = Schema.decodeUnknownSync(ClientSettingsSchema);

const validTheme = {
  name: "Catppuccin Mocha",
  appearance: "dark" as const,
  background: "#1e1e2e",
  foreground: "#cdd6f4",
  card: "#181825",
  cardForeground: "#cdd6f4",
  popover: "#181825",
  popoverForeground: "#cdd6f4",
  primary: "#89b4fa",
  primaryForeground: "#1e1e2e",
  secondary: "#313244",
  secondaryForeground: "#cdd6f4",
  muted: "#313244",
  mutedForeground: "#a6adc8",
  accent: "#313244",
  accentForeground: "#cdd6f4",
  destructive: "#f38ba8",
  destructiveForeground: "#1e1e2e",
  border: "#45475a",
  input: "#45475a",
  ring: "#89b4fa",
  info: "#89b4fa",
  infoForeground: "#89b4fa",
  success: "#a6e3a1",
  successForeground: "#a6e3a1",
  warning: "#f9e2af",
  warningForeground: "#f9e2af",
  cursor: "#f5e0dc",
  selectionBackground: "#585b7066",
  ansi: {
    black: "#45475a",
    red: "#f38ba8",
    green: "#a6e3a1",
    yellow: "#f9e2af",
    blue: "#89b4fa",
    magenta: "#f5c2e7",
    cyan: "#94e2d5",
    white: "#bac2de",
    brightBlack: "#585b70",
    brightRed: "#f38ba8",
    brightGreen: "#a6e3a1",
    brightYellow: "#f9e2af",
    brightBlue: "#89b4fa",
    brightMagenta: "#f5c2e7",
    brightCyan: "#94e2d5",
    brightWhite: "#a6adc8",
  },
};

describe("CssColor", () => {
  it("accepts hex and functional colors", () => {
    expect(decodeCssColor("#1e1e2e")).toBe("#1e1e2e");
    expect(decodeCssColor("rgba(0,0,0,0.2)")).toBe("rgba(0,0,0,0.2)");
    expect(decodeCssColor("oklch(0.5 0.1 264)")).toBe("oklch(0.5 0.1 264)");
    expect(decodeCssColor("white")).toBe("white");
  });

  it("rejects empty and oversized values", () => {
    expect(() => decodeCssColor("")).toThrow();
    expect(() => decodeCssColor("not a color!!!")).toThrow();
  });
});

describe("GeneratedColorTheme", () => {
  it("decodes a full semantic theme payload", () => {
    const theme = decodeGenerated(validTheme);
    expect(theme.name).toBe("Catppuccin Mocha");
    expect(theme.appearance).toBe("dark");
    expect(theme.ansi.blue).toBe("#89b4fa");
  });

  it("stores a generated theme with an assigned id", () => {
    const stored = makeStoredColorTheme({
      id: ColorThemeId.make("custom:abc"),
      theme: decodeGenerated(validTheme),
      sourcePrompt: "catppuccin mocha",
    });
    expect(stored.id).toBe("custom:abc");
    expect(stored.sourcePrompt).toBe("catppuccin mocha");
  });
});

describe("ClientSettings appearance fields", () => {
  it("defaults appearance slots to builtin t3-default", () => {
    const settings = decodeClientSettings({});
    expect(settings.appearanceLightThemeId).toBe(BUILTIN_DEFAULT_THEME_ID);
    expect(settings.appearanceDarkThemeId).toBe(BUILTIN_DEFAULT_THEME_ID);
    expect(settings.customColorThemes).toEqual([]);
    expect(settings.uiFontFamily).toBe("");
    expect(settings.uiFontSizePx).toBe(16);
  });
});
