import type { EditorId } from "@t3tools/contracts";
import { FolderClosedIcon } from "lucide-react";
import type { Icon } from "./components/Icons";
import {
  AntigravityIcon,
  CursorIcon,
  KiroIcon,
  TraeIcon,
  VisualStudioCode,
  VisualStudioCodeInsiders,
  VSCodium,
  Zed,
} from "./components/Icons";
import {
  AquaIcon,
  CLionIcon,
  DataGripIcon,
  DataSpellIcon,
  GoLandIcon,
  IntelliJIdeaIcon,
  PhpStormIcon,
  PyCharmIcon,
  RiderIcon,
  RubyMineIcon,
  RustRoverIcon,
  WebStormIcon,
} from "./components/JetBrainsIcons";
import { isMacPlatform, isWindowsPlatform } from "./lib/utils";

export type EditorOption = {
  readonly label: string;
  readonly Icon: Icon;
  readonly value: EditorId;
};

export function resolveEditorOptions(
  platform: string,
  availableEditors: ReadonlyArray<EditorId>,
): ReadonlyArray<EditorOption> {
  const options: ReadonlyArray<EditorOption> = [
    { label: "Cursor", Icon: CursorIcon, value: "cursor" },
    { label: "Trae", Icon: TraeIcon, value: "trae" },
    { label: "Kiro", Icon: KiroIcon, value: "kiro" },
    { label: "VS Code", Icon: VisualStudioCode, value: "vscode" },
    { label: "VS Code Insiders", Icon: VisualStudioCodeInsiders, value: "vscode-insiders" },
    { label: "VSCodium", Icon: VSCodium, value: "vscodium" },
    { label: "Zed", Icon: Zed, value: "zed" },
    { label: "Antigravity", Icon: AntigravityIcon, value: "antigravity" },
    { label: "IntelliJ IDEA", Icon: IntelliJIdeaIcon, value: "idea" },
    { label: "Aqua", Icon: AquaIcon, value: "aqua" },
    { label: "CLion", Icon: CLionIcon, value: "clion" },
    { label: "DataGrip", Icon: DataGripIcon, value: "datagrip" },
    { label: "DataSpell", Icon: DataSpellIcon, value: "dataspell" },
    { label: "GoLand", Icon: GoLandIcon, value: "goland" },
    { label: "PhpStorm", Icon: PhpStormIcon, value: "phpstorm" },
    { label: "PyCharm", Icon: PyCharmIcon, value: "pycharm" },
    { label: "Rider", Icon: RiderIcon, value: "rider" },
    { label: "RubyMine", Icon: RubyMineIcon, value: "rubymine" },
    { label: "RustRover", Icon: RustRoverIcon, value: "rustrover" },
    { label: "WebStorm", Icon: WebStormIcon, value: "webstorm" },
    {
      label: isMacPlatform(platform)
        ? "Finder"
        : isWindowsPlatform(platform)
          ? "Explorer"
          : "Files",
      Icon: FolderClosedIcon,
      value: "file-manager",
    },
  ];
  const available = new Set(availableEditors);
  return options.filter((option) => available.has(option.value));
}
