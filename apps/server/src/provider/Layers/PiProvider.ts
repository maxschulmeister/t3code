import {
  type ModelCapabilities,
  type PiSettings,
  type ServerProviderModel,
  type ServerProviderSlashCommand,
  ProviderDriverKind,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import { ChildProcess } from "effect/unstable/process";

import {
  buildServerProvider,
  DEFAULT_TIMEOUT_MS,
  detailFromResult,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
} from "../providerSnapshot.ts";
import {
  extractAvailableModels,
  extractPiSlashCommands,
  makePiRpcTransport,
  piModelInfoToServerModel,
} from "./PiRpcClient.ts";

const PROVIDER = ProviderDriverKind.make("pi");

const PI_PRESENTATION = {
  displayName: "Pi",
  badgeLabel: "Early Access",
  showInteractionModeToggle: true,
} as const;

const EMPTY_CAPABILITIES: ModelCapabilities = createModelCapabilities({ optionDescriptors: [] });

const PI_MODEL_DISCOVERY_TIMEOUT_MS = 15_000;

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

const runPiVersion = (piSettings: PiSettings, environment: NodeJS.ProcessEnv) =>
  Effect.suspend(() => {
    const binaryPath = piSettings.binaryPath || "pi";
    return Effect.gen(function* () {
      const spawnCommand = yield* resolveSpawnCommand(binaryPath, ["--version"], {
        env: environment,
        extendEnv: true,
      });
      const command = ChildProcess.make(spawnCommand.command, spawnCommand.args, {
        env: environment,
        extendEnv: true,
        shell: spawnCommand.shell,
      });
      return yield* spawnAndCollect(binaryPath, command);
    });
  });

/** Discover models via a short-lived `pi --mode rpc` session; `[]` on any failure. */
export const discoverPiModelsViaRpc = Effect.fn("discoverPiModelsViaRpc")(
  function* (piSettings: PiSettings, cwd: string, environment: NodeJS.ProcessEnv) {
    const transport = yield* makePiRpcTransport({
      binaryPath: piSettings.binaryPath || "pi",
      args: ["--mode", "rpc", "--no-session"],
      cwd,
      env: environment,
      onExit: Effect.void,
    });
    const response = yield* transport.request(
      { type: "get_available_models" },
      "pi-model-discovery",
      PI_MODEL_DISCOVERY_TIMEOUT_MS,
    );
    return extractAvailableModels(response).map(piModelInfoToServerModel);
  },
  Effect.scoped,
  Effect.timeoutOption(PI_MODEL_DISCOVERY_TIMEOUT_MS),
  Effect.map(Option.getOrElse(() => [] as ReadonlyArray<ServerProviderModel>)),
  Effect.catchCause((cause) =>
    Effect.logWarning("Pi model discovery failed", { cause }).pipe(
      Effect.as([] as ReadonlyArray<ServerProviderModel>),
    ),
  ),
);

/** Discover user commands via a short-lived `pi --mode rpc` session; `[]` on any failure. */
export const discoverPiSlashCommandsViaRpc = Effect.fn("discoverPiSlashCommandsViaRpc")(
  function* (piSettings: PiSettings, cwd: string, environment: NodeJS.ProcessEnv) {
    const transport = yield* makePiRpcTransport({
      binaryPath: piSettings.binaryPath || "pi",
      args: ["--mode", "rpc", "--no-session"],
      cwd,
      env: environment,
      onExit: Effect.void,
    });
    const response = yield* transport.request(
      { type: "get_commands" },
      "pi-command-discovery",
      PI_MODEL_DISCOVERY_TIMEOUT_MS,
    );
    return extractPiSlashCommands(response);
  },
  Effect.scoped,
  Effect.timeoutOption(PI_MODEL_DISCOVERY_TIMEOUT_MS),
  Effect.map(Option.getOrElse(() => [] as ReadonlyArray<ServerProviderSlashCommand>)),
  Effect.catchCause((cause) =>
    Effect.logWarning("Pi slash command discovery failed", { cause }).pipe(
      Effect.as([] as ReadonlyArray<ServerProviderSlashCommand>),
    ),
  ),
);

const modelsFromSettings = (
  piSettings: PiSettings,
  discovered: ReadonlyArray<ServerProviderModel>,
): ReadonlyArray<ServerProviderModel> =>
  providerModelsFromSettings(discovered, PROVIDER, piSettings.customModels, EMPTY_CAPABILITIES);

export const buildInitialPiProviderSnapshot = Effect.fn("buildInitialPiProviderSnapshot")(
  function* (piSettings: PiSettings) {
    const checkedAt = yield* nowIso;
    const models = modelsFromSettings(piSettings, []);

    if (!piSettings.enabled) {
      return buildServerProvider({
        presentation: PI_PRESENTATION,
        enabled: false,
        checkedAt,
        models,
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "Pi is disabled in T3 Code settings.",
        },
      });
    }

    return buildServerProvider({
      presentation: PI_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Checking Pi availability...",
      },
    });
  },
);

export const checkPiProviderStatus = Effect.fn("checkPiProviderStatus")(function* (
  piSettings: PiSettings,
  cwd: string,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const checkedAt = yield* nowIso;
  const fallbackModels = modelsFromSettings(piSettings, []);

  if (!piSettings.enabled) {
    return buildServerProvider({
      presentation: PI_PRESENTATION,
      enabled: false,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Pi is disabled in T3 Code settings.",
      },
    });
  }

  const versionProbe = yield* runPiVersion(piSettings, environment).pipe(
    Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
    Effect.result,
  );

  if (Result.isFailure(versionProbe)) {
    const error = versionProbe.failure;
    return buildServerProvider({
      presentation: PI_PRESENTATION,
      enabled: piSettings.enabled,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: !isCommandMissingCause(error),
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: isCommandMissingCause(error)
          ? "Pi CLI (`pi`) is not installed or not on PATH."
          : "Failed to execute Pi CLI health check.",
      },
    });
  }

  if (Option.isNone(versionProbe.success)) {
    return buildServerProvider({
      presentation: PI_PRESENTATION,
      enabled: piSettings.enabled,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: "Pi CLI is installed but timed out while running `pi --version`.",
      },
    });
  }

  const version = versionProbe.success.value;
  const parsedVersion = parseGenericCliVersion(`${version.stdout}\n${version.stderr}`);

  if (version.code !== 0) {
    const detail = detailFromResult(version);
    return buildServerProvider({
      presentation: PI_PRESENTATION,
      enabled: piSettings.enabled,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version: parsedVersion,
        status: "error",
        auth: { status: "unknown" },
        message: detail ?? "Pi CLI returned an error during health check.",
      },
    });
  }

  const [discoveredModels, slashCommands] = yield* Effect.all(
    [
      discoverPiModelsViaRpc(piSettings, cwd, environment),
      discoverPiSlashCommandsViaRpc(piSettings, cwd, environment),
    ],
    { concurrency: "unbounded" },
  );
  const models = modelsFromSettings(piSettings, discoveredModels);

  // no auth query in pi; available built-in or configured custom models imply usable setup
  const authenticated = models.length > 0;

  return buildServerProvider({
    presentation: PI_PRESENTATION,
    enabled: piSettings.enabled,
    checkedAt,
    models,
    slashCommands,
    probe: {
      installed: true,
      version: parsedVersion,
      status: authenticated ? "ready" : "warning",
      auth: { status: authenticated ? "authenticated" : "unknown", type: "pi" },
      ...(authenticated
        ? {}
        : {
            message:
              "Pi is installed but no models are available. Configure a provider or API key in ~/.pi/agent (e.g. run `pi`) so models appear.",
          }),
    },
  });
});
