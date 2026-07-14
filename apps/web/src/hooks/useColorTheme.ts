import {
  BUILTIN_DEFAULT_THEME_ID,
  ColorThemeId,
  DEFAULT_UI_FONT_SIZE_PX,
  makeStoredColorTheme,
  type GeneratedColorTheme,
  type StoredColorTheme,
} from "@t3tools/contracts";
import { useCallback, useEffect, useMemo } from "react";

import { usePrimarySettings, useUpdatePrimarySettings } from "~/hooks/useSettings";
import { useTheme } from "~/hooks/useTheme";
import {
  applyResolvedColorTheme,
  isBuiltinDefaultThemeId,
  resolveStoredOrBuiltinTheme,
} from "~/themes/applyColorTheme";
import { BUILTIN_COLOR_THEMES } from "~/themes/builtinThemes";

function makeCustomThemeId(): ColorThemeId {
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return ColorThemeId.make(`custom:${suffix}`);
}

export function useColorTheme() {
  const { resolvedTheme } = useTheme();
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();

  const activeThemeId =
    resolvedTheme === "dark" ? settings.appearanceDarkThemeId : settings.appearanceLightThemeId;

  const activeTheme = useMemo(
    () =>
      resolveStoredOrBuiltinTheme({
        themeId: activeThemeId,
        customThemes: settings.customColorThemes,
        builtinThemes: BUILTIN_COLOR_THEMES,
      }),
    [activeThemeId, settings.customColorThemes],
  );

  const availableThemes = useMemo(() => {
    const defaults: StoredColorTheme[] = [
      {
        id: BUILTIN_DEFAULT_THEME_ID,
        name: "T3 Default",
        appearance: resolvedTheme,
        background: resolvedTheme === "dark" ? "#161616" : "#ffffff",
        foreground: resolvedTheme === "dark" ? "#f5f5f5" : "#262626",
        card: resolvedTheme === "dark" ? "#1a1a1a" : "#ffffff",
        cardForeground: resolvedTheme === "dark" ? "#f5f5f5" : "#262626",
        popover: resolvedTheme === "dark" ? "#1a1a1a" : "#ffffff",
        popoverForeground: resolvedTheme === "dark" ? "#f5f5f5" : "#262626",
        primary: "#6366f1",
        primaryForeground: "#ffffff",
        secondary: resolvedTheme === "dark" ? "#262626" : "#f5f5f5",
        secondaryForeground: resolvedTheme === "dark" ? "#f5f5f5" : "#262626",
        muted: resolvedTheme === "dark" ? "#262626" : "#f5f5f5",
        mutedForeground: "#737373",
        accent: resolvedTheme === "dark" ? "#262626" : "#f5f5f5",
        accentForeground: resolvedTheme === "dark" ? "#f5f5f5" : "#262626",
        destructive: "#ef4444",
        destructiveForeground: "#ffffff",
        border: resolvedTheme === "dark" ? "#262626" : "#e5e5e5",
        input: resolvedTheme === "dark" ? "#262626" : "#e5e5e5",
        ring: "#6366f1",
        info: "#3b82f6",
        infoForeground: "#3b82f6",
        success: "#10b981",
        successForeground: "#10b981",
        warning: "#f59e0b",
        warningForeground: "#f59e0b",
        cursor: resolvedTheme === "dark" ? "#f5f5f5" : "#262626",
        selectionBackground: resolvedTheme === "dark" ? "#6366f140" : "#6366f133",
        ansi: {
          black: "#000000",
          red: "#ef4444",
          green: "#22c55e",
          yellow: "#eab308",
          blue: "#3b82f6",
          magenta: "#a855f7",
          cyan: "#06b6d4",
          white: "#e5e5e5",
          brightBlack: "#737373",
          brightRed: "#f87171",
          brightGreen: "#4ade80",
          brightYellow: "#facc15",
          brightBlue: "#60a5fa",
          brightMagenta: "#c084fc",
          brightCyan: "#22d3ee",
          brightWhite: "#fafafa",
        },
      },
    ];
    return [...defaults, ...BUILTIN_COLOR_THEMES, ...settings.customColorThemes];
  }, [resolvedTheme, settings.customColorThemes]);

  useEffect(() => {
    applyResolvedColorTheme({
      theme: activeTheme,
      uiFontFamily: settings.uiFontFamily,
      uiFontSizePx:
        settings.uiFontSizePx === DEFAULT_UI_FONT_SIZE_PX ? undefined : settings.uiFontSizePx,
    });
  }, [activeTheme, settings.uiFontFamily, settings.uiFontSizePx]);

  const setActiveThemeId = useCallback(
    (themeId: ColorThemeId) => {
      if (resolvedTheme === "dark") {
        updateSettings({ appearanceDarkThemeId: themeId });
      } else {
        updateSettings({ appearanceLightThemeId: themeId });
      }
    },
    [resolvedTheme, updateSettings],
  );

  const saveGeneratedTheme = useCallback(
    (theme: GeneratedColorTheme, sourcePrompt: string) => {
      const stored = makeStoredColorTheme({
        id: makeCustomThemeId(),
        theme,
        sourcePrompt,
        createdAt: new Date().toISOString(),
      });
      const nextCustom = [...settings.customColorThemes, stored];
      if (theme.appearance === "dark") {
        updateSettings({
          customColorThemes: nextCustom,
          appearanceDarkThemeId: stored.id,
        });
      } else {
        updateSettings({
          customColorThemes: nextCustom,
          appearanceLightThemeId: stored.id,
        });
      }
      return stored;
    },
    [settings.customColorThemes, updateSettings],
  );

  const removeCustomTheme = useCallback(
    (themeId: ColorThemeId) => {
      if (isBuiltinDefaultThemeId(themeId) || themeId.startsWith("builtin:")) return;
      const nextCustom = settings.customColorThemes.filter((theme) => theme.id !== themeId);
      updateSettings({
        customColorThemes: nextCustom,
        ...(settings.appearanceLightThemeId === themeId
          ? { appearanceLightThemeId: BUILTIN_DEFAULT_THEME_ID }
          : {}),
        ...(settings.appearanceDarkThemeId === themeId
          ? { appearanceDarkThemeId: BUILTIN_DEFAULT_THEME_ID }
          : {}),
      });
    },
    [
      settings.appearanceDarkThemeId,
      settings.appearanceLightThemeId,
      settings.customColorThemes,
      updateSettings,
    ],
  );

  return {
    resolvedTheme,
    activeThemeId,
    activeTheme,
    availableThemes,
    setActiveThemeId,
    saveGeneratedTheme,
    removeCustomTheme,
    uiFontFamily: settings.uiFontFamily,
    uiFontSizePx: settings.uiFontSizePx,
    setUiFontFamily: (uiFontFamily: string) => updateSettings({ uiFontFamily }),
    setUiFontSizePx: (uiFontSizePx: number) => updateSettings({ uiFontSizePx }),
  } as const;
}
