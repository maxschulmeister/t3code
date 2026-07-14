import { EDITORS, EditorId, EnvironmentId, type CustomApplication } from "@t3tools/contracts";
import {
  mapAtomCommandResult,
  type AtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";
import { AsyncResult } from "effect/unstable/reactivity";
import { getLocalStorageItem, setLocalStorageItem, useLocalStorage } from "./hooks/useLocalStorage";
import { useCallback, useMemo } from "react";
import { shellEnvironment } from "./state/shell";
import { useCustomApplications } from "./customApplications";
import { useAtomCommand } from "./state/use-atom-command";

const LAST_EDITOR_KEY = "t3code:last-editor";

export {
  editorPreferenceRef,
  editorPreferencesStorageKey,
  reconcileEditorPreferences,
  StoredEditorPreferences,
  type EditorPreferenceRef,
} from "./editorPreferenceModel";
import {
  editorPreferenceRef,
  editorPreferencesStorageKey,
  EMPTY_EDITOR_PREFERENCES,
  reconcileEditorPreferences,
  StoredEditorPreferences,
} from "./editorPreferenceModel";

export function useEditorPreferences(
  environmentId: EnvironmentId,
  availableEditors: readonly EditorId[],
  customApplications: ReadonlyArray<CustomApplication>,
) {
  const [stored, setStored] = useLocalStorage(
    editorPreferencesStorageKey(environmentId),
    EMPTY_EDITOR_PREFERENCES,
    StoredEditorPreferences,
  );
  const reconciled = useMemo(() => {
    const legacyDefault = getLocalStorageItem(LAST_EDITOR_KEY, EditorId);
    return reconcileEditorPreferences(
      stored.defaultEditor || !legacyDefault
        ? stored
        : { ...stored, defaultEditor: editorPreferenceRef(legacyDefault) },
      availableEditors,
      customApplications,
    );
  }, [availableEditors, customApplications, stored]);

  const setDefaultEditor = useCallback(
    (editor: EditorId | CustomApplication | null) => {
      const defaultEditor = editor ? editorPreferenceRef(editor) : null;
      setStored((current) => ({ ...current, defaultEditor }));
    },
    [setStored],
  );
  const setEditorOrder = useCallback(
    (editors: ReadonlyArray<EditorId | CustomApplication>) => {
      setStored((current) => ({
        ...current,
        order: editors.map(editorPreferenceRef),
      }));
    },
    [setStored],
  );

  return { ...reconciled, setDefaultEditor, setEditorOrder };
}

export class PreferredEditorEnvironmentRequiredError extends Schema.TaggedErrorClass<PreferredEditorEnvironmentRequiredError>()(
  "PreferredEditorEnvironmentRequiredError",
  { targetPath: Schema.String },
) {
  override get message(): string {
    return `Cannot open ${this.targetPath} because no environment is selected.`;
  }
}

export class PreferredEditorUnavailableError extends Schema.TaggedErrorClass<PreferredEditorUnavailableError>()(
  "PreferredEditorUnavailableError",
  {
    environmentId: EnvironmentId,
    targetPath: Schema.String,
    availableEditorIds: Schema.Array(EditorId),
  },
) {
  override get message(): string {
    return `No available editor can open ${this.targetPath} in environment ${this.environmentId}.`;
  }
}

/** Built-in-only compatibility seam for callers without environment custom-app data. */
export function resolveAndPersistPreferredEditor(
  availableEditors: readonly EditorId[],
): EditorId | null {
  const availableEditorIds = new Set(availableEditors);
  const stored = getLocalStorageItem(LAST_EDITOR_KEY, EditorId);
  if (stored && availableEditorIds.has(stored)) return stored;
  const editor = EDITORS.find((candidate) => availableEditorIds.has(candidate.id))?.id ?? null;
  if (editor) setLocalStorageItem(LAST_EDITOR_KEY, editor, EditorId);
  return editor;
}

export function useOpenInPreferredEditor(
  environmentId: EnvironmentId | null,
  availableEditors: readonly EditorId[],
) {
  const openInEditor = useAtomCommand(shellEnvironment.openInEditor, { reportFailure: false });
  const { applications: customApplications } = useCustomApplications(
    environmentId ?? "no-environment",
  );
  type OpenInEditorError = AtomCommandFailure<Awaited<ReturnType<typeof openInEditor>>>;

  return useCallback(
    async (
      targetPath: string,
    ): Promise<
      AtomCommandResult<
        EditorId | CustomApplication,
        | OpenInEditorError
        | PreferredEditorEnvironmentRequiredError
        | PreferredEditorUnavailableError
      >
    > => {
      if (environmentId === null) {
        return AsyncResult.failure(
          Cause.fail(new PreferredEditorEnvironmentRequiredError({ targetPath })),
        );
      }
      const stored =
        getLocalStorageItem(editorPreferencesStorageKey(environmentId), StoredEditorPreferences) ??
        EMPTY_EDITOR_PREFERENCES;
      const legacyDefault = getLocalStorageItem(LAST_EDITOR_KEY, EditorId);
      const editor = reconcileEditorPreferences(
        stored.defaultEditor || !legacyDefault
          ? stored
          : { ...stored, defaultEditor: editorPreferenceRef(legacyDefault) },
        availableEditors,
        customApplications,
      ).defaultEditor;
      if (!editor) {
        return AsyncResult.failure(
          Cause.fail(
            new PreferredEditorUnavailableError({
              environmentId,
              targetPath,
              availableEditorIds: availableEditors,
            }),
          ),
        );
      }
      const result = await openInEditor({
        environmentId,
        input: { cwd: targetPath, editor },
      });
      return mapAtomCommandResult(result, () => editor);
    },
    [availableEditors, customApplications, environmentId, openInEditor],
  );
}
