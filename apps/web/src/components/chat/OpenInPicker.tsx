import {
  EditorId,
  type CustomApplication,
  type EnvironmentId,
  type ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import { memo, useCallback, useEffect, useMemo } from "react";
import { isOpenFavoriteEditorShortcut, shortcutLabelForCommand } from "../../keybindings";
import { useEditorPreferences } from "../../editorPreferences";
import { ChevronDownIcon } from "lucide-react";
import { CustomApplicationIcon } from "../CustomApplicationIcon";
import { Button } from "../ui/button";
import { Group, GroupSeparator } from "../ui/group";
import { Menu, MenuItem, MenuPopup, MenuShortcut, MenuTrigger } from "../ui/menu";
import { useCustomApplications } from "~/customApplications";
import { resolveEditorOptions } from "~/editorOptions";
import { shellEnvironment } from "~/state/shell";
import { useAtomCommand } from "~/state/use-atom-command";

export const OpenInPicker = memo(function OpenInPicker({
  environmentId,
  keybindings,
  availableEditors,
  openInCwd,
  compact = false,
  enableShortcut = true,
}: {
  environmentId: EnvironmentId;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  openInCwd: string | null;
  compact?: boolean;
  enableShortcut?: boolean;
}) {
  const openInEditorMutation = useAtomCommand(shellEnvironment.openInEditor, "open in editor");
  const { applications } = useCustomApplications(environmentId);
  const options = useMemo(
    () => resolveEditorOptions(navigator.platform, availableEditors),
    [availableEditors],
  );
  const optionById = useMemo(
    () => new Map(options.map((option) => [option.value, option])),
    [options],
  );
  const { orderedEditors, defaultEditor } = useEditorPreferences(
    environmentId,
    availableEditors,
    applications,
  );
  const primaryOption =
    typeof defaultEditor === "string" ? (optionById.get(defaultEditor) ?? null) : null;

  const openInEditor = useCallback(
    (editor: EditorId | CustomApplication | null) => {
      if (!openInCwd || !editor) return;
      return openInEditorMutation({
        environmentId,
        input: { cwd: openInCwd, editor },
      });
    },
    [environmentId, openInCwd, openInEditorMutation],
  );

  const openFavoriteEditorShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "editor.openFavorite"),
    [keybindings],
  );

  useEffect(() => {
    if (!enableShortcut) return;
    const handler = (event: globalThis.KeyboardEvent) => {
      if (!isOpenFavoriteEditorShortcut(event, keybindings) || !openInCwd || !defaultEditor) return;
      event.preventDefault();
      void openInEditor(defaultEditor);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [defaultEditor, enableShortcut, keybindings, openInCwd, openInEditor]);

  return (
    <Group aria-label="Open in editor">
      <Button
        aria-label={compact ? "Open file in preferred editor" : undefined}
        size="xs"
        variant="outline"
        disabled={!defaultEditor || !openInCwd}
        onClick={() => openInEditor(defaultEditor)}
      >
        {primaryOption ? (
          <primaryOption.Icon aria-hidden="true" className="size-3.5" />
        ) : defaultEditor && typeof defaultEditor !== "string" ? (
          <CustomApplicationIcon application={defaultEditor} className="size-3.5" />
        ) : null}
        <span
          className={
            compact
              ? "sr-only"
              : "sr-only @3xl/header-actions:not-sr-only @3xl/header-actions:ml-0.5"
          }
        >
          Open
        </span>
      </Button>
      <GroupSeparator {...(!compact ? { className: "hidden @3xl/header-actions:block" } : {})} />
      <Menu>
        <MenuTrigger
          render={<Button aria-label="Choose editor" size="icon-xs" variant="outline" />}
        >
          <ChevronDownIcon aria-hidden="true" className="size-4" />
        </MenuTrigger>
        <MenuPopup align="end">
          {orderedEditors.length === 0 && <MenuItem disabled>No installed editors found</MenuItem>}
          {orderedEditors.map((editor) => {
            if (typeof editor === "string") {
              const option = optionById.get(editor);
              if (!option) return null;
              return (
                <MenuItem key={editor} onClick={() => openInEditor(editor)}>
                  <option.Icon aria-hidden="true" className="text-muted-foreground" />
                  {option.label}
                  {editor === defaultEditor && openFavoriteEditorShortcutLabel ? (
                    <MenuShortcut>{openFavoriteEditorShortcutLabel}</MenuShortcut>
                  ) : null}
                </MenuItem>
              );
            }
            return (
              <MenuItem key={editor.id} onClick={() => openInEditor(editor)}>
                <CustomApplicationIcon
                  application={editor}
                  className="size-4 text-muted-foreground"
                />
                <span className="min-w-0 flex-1 truncate">{editor.name}</span>
                {defaultEditor !== null &&
                typeof defaultEditor !== "string" &&
                defaultEditor.id === editor.id &&
                openFavoriteEditorShortcutLabel ? (
                  <MenuShortcut>{openFavoriteEditorShortcutLabel}</MenuShortcut>
                ) : null}
              </MenuItem>
            );
          })}
        </MenuPopup>
      </Menu>
    </Group>
  );
});
