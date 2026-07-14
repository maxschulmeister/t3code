import { useAtomValue } from "@effect/atom-react";
import {
  BUILTIN_DEFAULT_THEME_ID,
  ColorThemeId,
  DEFAULT_UI_FONT_SIZE_PX,
  MAX_UI_FONT_SIZE_PX,
  MIN_UI_FONT_SIZE_PX,
  type GeneratedColorTheme,
} from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Loader2Icon, SparklesIcon, Trash2Icon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { useColorTheme } from "~/hooks/useColorTheme";
import { usePrimarySettings } from "~/hooks/useSettings";
import { useTheme } from "~/hooks/useTheme";
import { resolveAppModelSelectionState } from "~/modelSelection";
import { usePrimaryEnvironment } from "~/state/environments";
import { primaryServerProvidersAtom, serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";

const THEME_OPTIONS = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

const SWATCH_KEYS = [
  "background",
  "foreground",
  "primary",
  "card",
  "muted",
  "border",
  "destructive",
  "info",
  "success",
  "warning",
] as const satisfies ReadonlyArray<keyof GeneratedColorTheme>;

function ThemeSwatches({ theme }: { theme: GeneratedColorTheme }) {
  return (
    <div className="flex flex-wrap gap-1">
      {SWATCH_KEYS.map((key) => (
        <div
          key={key}
          className="size-4 rounded-sm border border-border/60"
          style={{ backgroundColor: theme[key] }}
          title={`${key}: ${theme[key]}`}
        />
      ))}
    </div>
  );
}

export function AppearanceSettingsPanel() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const settings = usePrimarySettings();
  const {
    activeThemeId,
    activeTheme,
    availableThemes,
    setActiveThemeId,
    saveGeneratedTheme,
    removeCustomTheme,
    uiFontFamily,
    uiFontSizePx,
    setUiFontFamily,
    setUiFontSizePx,
  } = useColorTheme();

  const primaryEnvironment = usePrimaryEnvironment();
  const serverProviders = useAtomValue(primaryServerProvidersAtom);
  const generateColorTheme = useAtomCommand(
    serverEnvironment.generateColorTheme,
    "generate color theme",
  );

  const modelSelection = resolveAppModelSelectionState(settings, serverProviders);

  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [draftTheme, setDraftTheme] = useState<GeneratedColorTheme | null>(null);

  const themesForMode = useMemo(
    () =>
      availableThemes.filter(
        (entry) => entry.id === BUILTIN_DEFAULT_THEME_ID || entry.appearance === resolvedTheme,
      ),
    [availableThemes, resolvedTheme],
  );

  const customThemes = useMemo(
    () => availableThemes.filter((entry) => entry.id.startsWith("custom:")),
    [availableThemes],
  );

  const handleGenerate = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed || !primaryEnvironment) return;
    setIsGenerating(true);
    setGenerateError(null);
    setDraftTheme(null);
    try {
      const result = await generateColorTheme({
        environmentId: primaryEnvironment.environmentId,
        input: {
          prompt: trimmed,
          modelSelection,
          preferredAppearance: resolvedTheme,
        },
      });
      if (result._tag === "Failure") {
        const error = squashAtomCommandFailure(result);
        setGenerateError(error instanceof Error ? error.message : "Theme generation failed.");
        return;
      }
      setDraftTheme(result.value.theme);
    } catch (error) {
      setGenerateError(error instanceof Error ? error.message : "Theme generation failed.");
    } finally {
      setIsGenerating(false);
    }
  }, [generateColorTheme, modelSelection, primaryEnvironment, prompt, resolvedTheme]);

  const handleApplyDraft = useCallback(() => {
    if (!draftTheme) return;
    saveGeneratedTheme(draftTheme, prompt.trim());
    setDraftTheme(null);
    setPrompt("");
  }, [draftTheme, prompt, saveGeneratedTheme]);

  return (
    <SettingsPageContainer>
      <SettingsSection title="Theme">
        <SettingsRow
          title="Mode"
          description="Light, dark, or follow the system preference."
          resetAction={
            theme !== "system" ? (
              <SettingResetButton label="mode" onClick={() => setTheme("system")} />
            ) : null
          }
          control={
            <Select
              value={theme}
              onValueChange={(value) => {
                if (value === "system" || value === "light" || value === "dark") {
                  setTheme(value);
                }
              }}
            >
              <SelectTrigger className="w-full sm:w-40" aria-label="Theme preference">
                <SelectValue>
                  {THEME_OPTIONS.find((option) => option.value === theme)?.label ?? "System"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {THEME_OPTIONS.map((option) => (
                  <SelectItem hideIndicator key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />

        <SettingsRow
          title={`${resolvedTheme === "dark" ? "Dark" : "Light"} color theme`}
          description="Palette for the current mode. Pick a preset or generate one below."
          resetAction={
            activeThemeId !== BUILTIN_DEFAULT_THEME_ID ? (
              <SettingResetButton
                label="color theme"
                onClick={() => setActiveThemeId(BUILTIN_DEFAULT_THEME_ID)}
              />
            ) : null
          }
          control={
            <Select
              value={activeThemeId}
              onValueChange={(value) => {
                if (typeof value === "string" && value.length > 0) {
                  setActiveThemeId(ColorThemeId.make(value));
                }
              }}
            >
              <SelectTrigger className="w-full sm:w-48" aria-label="Color theme">
                <SelectValue>
                  {themesForMode.find((entry) => entry.id === activeThemeId)?.name ?? "T3 Default"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {themesForMode.map((entry) => (
                  <SelectItem hideIndicator key={entry.id} value={entry.id}>
                    {entry.name}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
          status={activeTheme ? <ThemeSwatches theme={activeTheme} /> : null}
        />
      </SettingsSection>

      <SettingsSection title="Generate">
        <SettingsRow
          title="From prompt"
          description="Describe a look, paste a theme config, or write anything. Uses your Text generation model."
        >
          <div className="space-y-3 pb-3.5">
            <Textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="e.g. cozy warm dark coffee shop, Catppuccin Mocha, or paste a theme config"
              rows={4}
              aria-label="Theme generation prompt"
            />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
              {draftTheme ? (
                <Button type="button" variant="outline" size="sm" onClick={handleApplyDraft}>
                  Save &amp; apply “{draftTheme.name}”
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                disabled={isGenerating || prompt.trim().length === 0 || !primaryEnvironment}
                onClick={() => void handleGenerate()}
              >
                {isGenerating ? (
                  <Loader2Icon className="size-3.5 animate-spin" />
                ) : (
                  <SparklesIcon className="size-3.5" />
                )}
                Generate
              </Button>
            </div>
            {draftTheme ? <ThemeSwatches theme={draftTheme} /> : null}
            {generateError ? <p className="text-destructive text-xs">{generateError}</p> : null}
          </div>
        </SettingsRow>

        {customThemes.length > 0 ? (
          <SettingsRow
            title="Custom themes"
            description="Generated themes. Deleting one clears it from both mode slots if selected."
          >
            <ul className="divide-y divide-border/60 border-t border-border/60">
              {customThemes.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center justify-between gap-3 py-2.5 first:pt-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{entry.name}</p>
                    <p className="text-muted-foreground text-xs capitalize">{entry.appearance}</p>
                  </div>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Delete ${entry.name}`}
                    onClick={() => removeCustomTheme(entry.id)}
                  >
                    <Trash2Icon className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          </SettingsRow>
        ) : null}
      </SettingsSection>

      <SettingsSection title="Typography">
        <SettingsRow
          title="UI font family"
          description="Leave blank for the default (DM Sans)."
          resetAction={
            uiFontFamily.trim().length > 0 ? (
              <SettingResetButton label="font family" onClick={() => setUiFontFamily("")} />
            ) : null
          }
          control={
            <Input
              className="w-full sm:w-56"
              value={uiFontFamily}
              placeholder="e.g. Inter, SF Pro Text"
              aria-label="UI font family"
              onChange={(event) => setUiFontFamily(event.target.value)}
            />
          }
        />

        <SettingsRow
          title="UI font size"
          description="Root font size in pixels. Scales rem-based UI."
          resetAction={
            uiFontSizePx !== DEFAULT_UI_FONT_SIZE_PX ? (
              <SettingResetButton
                label="font size"
                onClick={() => setUiFontSizePx(DEFAULT_UI_FONT_SIZE_PX)}
              />
            ) : null
          }
          control={
            <Input
              type="number"
              className="w-full sm:w-24"
              min={MIN_UI_FONT_SIZE_PX}
              max={MAX_UI_FONT_SIZE_PX}
              step={1}
              value={uiFontSizePx}
              aria-label="UI font size"
              onChange={(event) => {
                const next = Number(event.target.value);
                if (
                  Number.isFinite(next) &&
                  next >= MIN_UI_FONT_SIZE_PX &&
                  next <= MAX_UI_FONT_SIZE_PX
                ) {
                  setUiFontSizePx(next);
                }
              }}
            />
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
