import { beforeEach, describe, expect, it } from "vite-plus/test";

import type { CustomApplication } from "@t3tools/contracts";
import { removeLocalStorageItem } from "./hooks/useLocalStorage";
import {
  addCustomApplication,
  customApplicationsStorageKey,
  readCustomApplications,
  removeCustomApplication,
} from "./customApplications";

const environmentId = "local";

const vscode: CustomApplication = {
  id: "/Applications/Visual Studio Code.app",
  path: "/Applications/Visual Studio Code.app",
  name: "Visual Studio Code",
};

const zed: CustomApplication = {
  id: "/Applications/Zed.app",
  path: "/Applications/Zed.app",
  name: "Zed",
};

describe("customApplications", () => {
  beforeEach(() => {
    removeLocalStorageItem(customApplicationsStorageKey(environmentId));
  });

  it("persists applications without duplicate ids", () => {
    addCustomApplication(environmentId, vscode);
    addCustomApplication(environmentId, vscode);
    addCustomApplication(environmentId, zed);

    expect(readCustomApplications(environmentId)).toEqual([vscode, zed]);
  });

  it("removes an application by id", () => {
    addCustomApplication(environmentId, vscode);
    addCustomApplication(environmentId, zed);

    removeCustomApplication(environmentId, vscode.id);

    expect(readCustomApplications(environmentId)).toEqual([zed]);
  });
});
