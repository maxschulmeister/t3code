import { expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { CustomApplication, LaunchEditorInput, SelectCustomApplicationResult } from "./editor.ts";

const decodeCustomApplication = Schema.decodeUnknownSync(CustomApplication);
const decodeLaunchEditorInput = Schema.decodeUnknownSync(LaunchEditorInput);
const decodeSelection = Schema.decodeUnknownSync(SelectCustomApplicationResult);
const application = {
  id: "/Applications/Visual Studio Code.app",
  path: "/Applications/Visual Studio Code.app",
  name: "Visual Studio Code",
};
const iconDataUrl = "data:image/png;base64,iVBORw0KGgo=";

it("accepts persisted macOS application records and selection cancellation", () => {
  expect(decodeCustomApplication(application)).toEqual(application);
  expect(decodeSelection({ application })).toEqual({ application });
  expect(decodeSelection({ application: null })).toEqual({ application: null });
});

it("accepts optional PNG icons and rejects unsafe or oversized data URLs", () => {
  expect(decodeCustomApplication({ ...application, iconDataUrl })).toEqual({
    ...application,
    iconDataUrl,
  });
  expect(() =>
    decodeCustomApplication({ ...application, iconDataUrl: "data:image/svg+xml,<svg/>" }),
  ).toThrow();
  expect(() =>
    decodeCustomApplication({
      ...application,
      iconDataUrl: `data:image/png;base64,${"a".repeat(512_001)}`,
    }),
  ).toThrow();
});

it("accepts built-in and custom launch targets", () => {
  expect(decodeLaunchEditorInput({ cwd: "/tmp/project", editor: "cursor" })).toEqual({
    cwd: "/tmp/project",
    editor: "cursor",
  });
  expect(decodeLaunchEditorInput({ cwd: "/tmp/project", editor: application })).toEqual({
    cwd: "/tmp/project",
    editor: application,
  });
});

it("rejects custom application paths without an .app suffix", () => {
  expect(() =>
    decodeCustomApplication({ ...application, path: "/Applications/Visual Studio Code" }),
  ).toThrow();
});
