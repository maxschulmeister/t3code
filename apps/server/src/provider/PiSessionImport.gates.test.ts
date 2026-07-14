import {
  DEFAULT_SERVER_SETTINGS,
  PiSettings,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerSettings,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  isPiProviderEnabled,
  shouldAutoImportPiSessions,
} from "./Layers/PiSessionImportService.ts";

const decodePiSettings = Schema.decodeSync(PiSettings);
const PI = ProviderDriverKind.make("pi");

function settingsWithPi(input: {
  readonly enabled: boolean;
  readonly autoImportSessions?: boolean;
}): ServerSettings {
  return {
    ...DEFAULT_SERVER_SETTINGS,
    providerInstances: {
      [ProviderInstanceId.make("pi")]: {
        driver: PI,
        enabled: input.enabled,
        config: decodePiSettings({
          enabled: input.enabled,
          ...(input.autoImportSessions !== undefined
            ? { autoImportSessions: input.autoImportSessions }
            : {}),
        }),
      },
    },
  };
}

describe("PiSessionImport auto-import gates", () => {
  it("defaults autoImportSessions to true", () => {
    expect(decodePiSettings({}).autoImportSessions).toBe(true);
  });

  it("requires an enabled Pi instance", () => {
    expect(isPiProviderEnabled(settingsWithPi({ enabled: false }))).toBe(false);
    expect(shouldAutoImportPiSessions(settingsWithPi({ enabled: false }))).toBe(false);
  });

  it("is eligible when Pi is enabled and auto-import defaults on", () => {
    expect(shouldAutoImportPiSessions(settingsWithPi({ enabled: true }))).toBe(true);
  });

  it("respects autoImportSessions=false", () => {
    expect(
      shouldAutoImportPiSessions(settingsWithPi({ enabled: true, autoImportSessions: false })),
    ).toBe(false);
  });
});
