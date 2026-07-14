import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const EditorLaunchStyle = Schema.Literals(["direct-path", "goto", "line-column"]);
export type EditorLaunchStyle = typeof EditorLaunchStyle.Type;

type EditorDefinition = {
  readonly id: string;
  readonly label: string;
  readonly commands: readonly [string, ...string[]] | null;
  readonly baseArgs?: readonly string[];
  readonly launchStyle: EditorLaunchStyle;
};

export const EDITORS = [
  { id: "cursor", label: "Cursor", commands: ["cursor"], launchStyle: "goto" },
  { id: "trae", label: "Trae", commands: ["trae"], launchStyle: "goto" },
  { id: "kiro", label: "Kiro", commands: ["kiro"], baseArgs: ["ide"], launchStyle: "goto" },
  { id: "vscode", label: "VS Code", commands: ["code"], launchStyle: "goto" },
  {
    id: "vscode-insiders",
    label: "VS Code Insiders",
    commands: ["code-insiders"],
    launchStyle: "goto",
  },
  { id: "vscodium", label: "VSCodium", commands: ["codium"], launchStyle: "goto" },
  { id: "zed", label: "Zed", commands: ["zed", "zeditor"], launchStyle: "direct-path" },
  { id: "antigravity", label: "Antigravity", commands: ["agy"], launchStyle: "goto" },
  { id: "idea", label: "IntelliJ IDEA", commands: ["idea"], launchStyle: "line-column" },
  { id: "aqua", label: "Aqua", commands: ["aqua"], launchStyle: "line-column" },
  { id: "clion", label: "CLion", commands: ["clion"], launchStyle: "line-column" },
  { id: "datagrip", label: "DataGrip", commands: ["datagrip"], launchStyle: "line-column" },
  { id: "dataspell", label: "DataSpell", commands: ["dataspell"], launchStyle: "line-column" },
  { id: "goland", label: "GoLand", commands: ["goland"], launchStyle: "line-column" },
  { id: "phpstorm", label: "PhpStorm", commands: ["phpstorm"], launchStyle: "line-column" },
  { id: "pycharm", label: "PyCharm", commands: ["pycharm"], launchStyle: "line-column" },
  { id: "rider", label: "Rider", commands: ["rider"], launchStyle: "line-column" },
  { id: "rubymine", label: "RubyMine", commands: ["rubymine"], launchStyle: "line-column" },
  { id: "rustrover", label: "RustRover", commands: ["rustrover"], launchStyle: "line-column" },
  { id: "webstorm", label: "WebStorm", commands: ["webstorm"], launchStyle: "line-column" },
  { id: "file-manager", label: "File Manager", commands: null, launchStyle: "direct-path" },
] as const satisfies ReadonlyArray<EditorDefinition>;

export const EditorId = Schema.Literals(EDITORS.map((e) => e.id));
export type EditorId = typeof EditorId.Type;

export const MacOsApplicationPath = TrimmedNonEmptyString.check(Schema.isEndsWith(".app"));
export type MacOsApplicationPath = typeof MacOsApplicationPath.Type;

export const CUSTOM_APPLICATION_ICON_DATA_URL_MAX_LENGTH = 512_000;
export const CustomApplicationIconDataUrl = Schema.String.check(
  Schema.isMaxLength(CUSTOM_APPLICATION_ICON_DATA_URL_MAX_LENGTH),
  Schema.isPattern(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/),
);
export type CustomApplicationIconDataUrl = typeof CustomApplicationIconDataUrl.Type;

/** Stable shape suitable for client persistence. Path doubles as id across selections. */
export const CustomApplication = Schema.Struct({
  id: TrimmedNonEmptyString,
  path: MacOsApplicationPath,
  name: TrimmedNonEmptyString,
  iconDataUrl: Schema.optional(CustomApplicationIconDataUrl),
});
export type CustomApplication = typeof CustomApplication.Type;

export const SelectCustomApplicationResult = Schema.Struct({
  application: Schema.NullOr(CustomApplication),
});
export type SelectCustomApplicationResult = typeof SelectCustomApplicationResult.Type;

export const LaunchEditorInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  editor: Schema.Union([EditorId, CustomApplication]),
});
export type LaunchEditorInput = typeof LaunchEditorInput.Type;

export class ExternalLauncherUnsupportedPlatformError extends Schema.TaggedErrorClass<ExternalLauncherUnsupportedPlatformError>()(
  "ExternalLauncherUnsupportedPlatformError",
  {
    operation: Schema.Literals(["select-custom-application", "launch-custom-application"]),
    platform: Schema.String,
  },
) {
  override get message(): string {
    return `Unsupported platform for ${this.operation}: ${this.platform}`;
  }
}

export class ExternalLauncherInvalidApplicationPathError extends Schema.TaggedErrorClass<ExternalLauncherInvalidApplicationPathError>()(
  "ExternalLauncherInvalidApplicationPathError",
  { path: Schema.String },
) {
  override get message(): string {
    return `Custom application path must end in .app: ${this.path}`;
  }
}

export class ExternalLauncherApplicationSelectionError extends Schema.TaggedErrorClass<ExternalLauncherApplicationSelectionError>()(
  "ExternalLauncherApplicationSelectionError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Failed to select macOS application";
  }
}

export class ExternalLauncherUnknownEditorError extends Schema.TaggedErrorClass<ExternalLauncherUnknownEditorError>()(
  "ExternalLauncherUnknownEditorError",
  {
    editor: Schema.String,
  },
) {
  override get message(): string {
    return `Unknown editor: ${this.editor}`;
  }
}

export class ExternalLauncherUnsupportedEditorError extends Schema.TaggedErrorClass<ExternalLauncherUnsupportedEditorError>()(
  "ExternalLauncherUnsupportedEditorError",
  {
    editor: EditorId,
  },
) {
  override get message(): string {
    return `Unsupported editor: ${this.editor}`;
  }
}

export class ExternalLauncherCommandNotFoundError extends Schema.TaggedErrorClass<ExternalLauncherCommandNotFoundError>()(
  "ExternalLauncherCommandNotFoundError",
  {
    editor: Schema.String,
    command: Schema.String,
  },
) {
  override get message(): string {
    return `Editor command not found: ${this.command}`;
  }
}

const ExternalLauncherSpawnFields = {
  command: Schema.String,
  args: Schema.Array(Schema.String),
  cause: Schema.Defect(),
};

export class ExternalLauncherBrowserSpawnError extends Schema.TaggedErrorClass<ExternalLauncherBrowserSpawnError>()(
  "ExternalLauncherBrowserSpawnError",
  {
    ...ExternalLauncherSpawnFields,
    target: Schema.String,
  },
) {
  override get message(): string {
    return `Failed to launch browser target '${this.target}' with '${[this.command, ...this.args].join(" ")}'`;
  }
}

export class ExternalLauncherEditorSpawnError extends Schema.TaggedErrorClass<ExternalLauncherEditorSpawnError>()(
  "ExternalLauncherEditorSpawnError",
  {
    ...ExternalLauncherSpawnFields,
    editor: Schema.String,
    target: Schema.String,
  },
) {
  override get message(): string {
    return `Failed to launch '${this.target}' in ${this.editor} with '${[this.command, ...this.args].join(" ")}'`;
  }
}

export const ExternalLauncherError = Schema.Union([
  ExternalLauncherUnsupportedPlatformError,
  ExternalLauncherInvalidApplicationPathError,
  ExternalLauncherApplicationSelectionError,
  ExternalLauncherUnknownEditorError,
  ExternalLauncherUnsupportedEditorError,
  ExternalLauncherCommandNotFoundError,
  ExternalLauncherBrowserSpawnError,
  ExternalLauncherEditorSpawnError,
]);
export type ExternalLauncherError = typeof ExternalLauncherError.Type;

export const isExternalLauncherError = Schema.is(ExternalLauncherError);
