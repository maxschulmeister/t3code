import { describe, expect, it } from "vite-plus/test";

import type { CustomApplication } from "@t3tools/contracts";
import {
  editorPreferenceRef,
  reconcileEditorPreferences,
  type StoredEditorPreferences,
} from "./editorPreferenceModel";

const zed: CustomApplication = {
  id: "/Applications/Zed.app",
  path: "/Applications/Zed.app",
  name: "Zed Preview",
};

function stored(
  order: StoredEditorPreferences["order"],
  defaultEditor: StoredEditorPreferences["defaultEditor"],
): StoredEditorPreferences {
  return { order, defaultEditor };
}

describe("reconcileEditorPreferences", () => {
  it("keeps configured order and appends newly available editors", () => {
    const result = reconcileEditorPreferences(
      stored(
        [editorPreferenceRef("vscode"), { _tag: "CustomApplication", id: zed.id }],
        editorPreferenceRef("vscode"),
      ),
      ["cursor", "vscode"],
      [zed],
    );

    expect(result.orderedEditors).toEqual(["vscode", zed, "cursor"]);
    expect(result.defaultEditor).toBe("vscode");
  });

  it("drops unavailable and duplicate entries then reconciles an unavailable default", () => {
    const result = reconcileEditorPreferences(
      stored(
        [editorPreferenceRef("kiro"), editorPreferenceRef("cursor"), editorPreferenceRef("cursor")],
        editorPreferenceRef("kiro"),
      ),
      ["cursor", "vscode"],
      [],
    );

    expect(result.orderedEditors).toEqual(["cursor", "vscode"]);
    expect(result.defaultEditor).toBe("cursor");
  });

  it("resolves a configured custom application as default", () => {
    const result = reconcileEditorPreferences(
      stored([{ _tag: "CustomApplication", id: zed.id }, editorPreferenceRef("vscode")], {
        _tag: "CustomApplication",
        id: zed.id,
      }),
      ["vscode"],
      [zed],
    );

    expect(result.defaultEditor).toEqual(zed);
  });
});
