import { EDITORS, EditorId, type CustomApplication } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const BuiltInEditorRef = Schema.Struct({
  _tag: Schema.Literal("BuiltInEditor"),
  id: EditorId,
});
const CustomApplicationRef = Schema.Struct({
  _tag: Schema.Literal("CustomApplication"),
  id: Schema.String,
});
export const EditorPreferenceRef = Schema.Union([BuiltInEditorRef, CustomApplicationRef]);
export type EditorPreferenceRef = typeof EditorPreferenceRef.Type;

export const StoredEditorPreferences = Schema.Struct({
  order: Schema.Array(EditorPreferenceRef),
  defaultEditor: Schema.NullOr(EditorPreferenceRef),
});
export type StoredEditorPreferences = typeof StoredEditorPreferences.Type;

export const EMPTY_EDITOR_PREFERENCES: StoredEditorPreferences = {
  order: [],
  defaultEditor: null,
};

export function editorPreferencesStorageKey(environmentId: string): string {
  return `t3code:editor-preferences:${environmentId}:v1`;
}

export function editorPreferenceRef(editor: EditorId | CustomApplication): EditorPreferenceRef {
  return typeof editor === "string"
    ? { _tag: "BuiltInEditor", id: editor }
    : { _tag: "CustomApplication", id: editor.id };
}

function refKey(ref: EditorPreferenceRef): string {
  return `${ref._tag}:${ref.id}`;
}

export function reconcileEditorPreferences(
  stored: StoredEditorPreferences,
  availableEditors: readonly EditorId[],
  customApplications: ReadonlyArray<CustomApplication>,
): {
  orderedEditors: ReadonlyArray<EditorId | CustomApplication>;
  defaultEditor: EditorId | CustomApplication | null;
} {
  const available = new Map<string, EditorId | CustomApplication>();
  for (const editor of EDITORS) {
    if (availableEditors.includes(editor.id)) {
      available.set(refKey(editorPreferenceRef(editor.id)), editor.id);
    }
  }
  for (const application of customApplications) {
    available.set(refKey(editorPreferenceRef(application)), application);
  }

  const orderedEditors: Array<EditorId | CustomApplication> = [];
  const used = new Set<string>();
  for (const ref of stored.order) {
    const key = refKey(ref);
    const editor = available.get(key);
    if (editor && !used.has(key)) {
      orderedEditors.push(editor);
      used.add(key);
    }
  }
  for (const [key, editor] of available) {
    if (!used.has(key)) orderedEditors.push(editor);
  }

  const configuredDefault = stored.defaultEditor
    ? available.get(refKey(stored.defaultEditor))
    : undefined;
  return {
    orderedEditors,
    defaultEditor: configuredDefault ?? orderedEditors[0] ?? null,
  };
}
