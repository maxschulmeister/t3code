import * as NodeOS from "node:os";

import {
  defaultInstanceIdForDriver,
  ProviderDriverKind,
  type ProviderInstanceId,
  type ServerSettings,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { expandHomePath } from "../pathExpansion.ts";
import { mergeProviderInstanceEnvironment } from "./ProviderInstanceEnvironment.ts";
import {
  derivePiSessionTitle,
  isPathEqualOrUnder,
  isPiSubagentSession,
  parsePiSessionHeaderLine,
  parsePiSessionJsonl,
  type PiParsedSession,
} from "./PiSessionFormat.ts";

const PI_DRIVER = ProviderDriverKind.make("pi");

export type PiSessionDiscoveryMatchReason = "cwd-prefix" | "git-identity";

export type PiDiscoveredSession = PiParsedSession & {
  readonly title: string;
  readonly matchReason: PiSessionDiscoveryMatchReason;
  readonly providerInstanceId: ProviderInstanceId;
};

export type DiscoverPiSessionsInput = {
  readonly settings: ServerSettings;
  readonly workspaceRoot: string;
  readonly projectCanonicalKey: string | null;
  readonly providerInstanceId?: ProviderInstanceId;
  readonly resolveCanonicalKey: (cwd: string) => Effect.Effect<string | null>;
};

function resolvePiAgentDir(
  settings: ServerSettings,
  instanceId: ProviderInstanceId,
  pathApi: Path.Path,
): string {
  const instance = settings.providerInstances[instanceId];
  const processEnv = mergeProviderInstanceEnvironment(instance?.environment);
  const configured = processEnv.PI_CODING_AGENT_DIR?.trim();
  if (configured && configured.length > 0) {
    return pathApi.resolve(expandHomePath(configured));
  }
  return pathApi.resolve(pathApi.join(NodeOS.homedir(), ".pi", "agent"));
}

function listEnabledPiInstanceIds(settings: ServerSettings): ProviderInstanceId[] {
  return Object.entries(settings.providerInstances)
    .filter(([, instance]) => instance.driver === PI_DRIVER && instance.enabled !== false)
    .map(([instanceId]) => instanceId as ProviderInstanceId);
}

const readSessionHeader = Effect.fn("PiSessionDiscovery.readSessionHeader")(function* (
  sessionFile: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const contents = yield* fs.readFileString(sessionFile).pipe(Effect.option);
  if (contents._tag === "None") {
    return undefined;
  }
  const firstLine = contents.value.split("\n", 1)[0] ?? "";
  return parsePiSessionHeaderLine(firstLine);
});

const readFullSession = Effect.fn("PiSessionDiscovery.readFullSession")(function* (
  sessionFile: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const contents = yield* fs.readFileString(sessionFile).pipe(Effect.option);
  if (contents._tag === "None") {
    return undefined;
  }
  return parsePiSessionJsonl(sessionFile, contents.value);
});

/**
 * Discover Pi session files that belong to a T3 project.
 *
 * Match rules (in order):
 * 1. Session `cwd` equals or is under `workspaceRoot`
 * 2. Else, session `cwd` shares the project's git `canonicalKey` (worktrees anywhere)
 */
export const discoverPiSessionsForProject = Effect.fn("discoverPiSessionsForProject")(function* (
  input: DiscoverPiSessionsInput,
) {
  const pathApi = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  const workspaceRoot = pathApi.resolve(expandHomePath(input.workspaceRoot.trim()));

  const instanceIds: ProviderInstanceId[] =
    input.providerInstanceId !== undefined
      ? [input.providerInstanceId]
      : listEnabledPiInstanceIds(input.settings);

  if (instanceIds.length === 0) {
    const fallback = defaultInstanceIdForDriver(PI_DRIVER);
    const fallbackInstance = input.settings.providerInstances[fallback];
    if (!fallbackInstance || fallbackInstance.enabled === false) {
      return [] as ReadonlyArray<PiDiscoveredSession>;
    }
    instanceIds.push(fallback);
  }

  const discovered: PiDiscoveredSession[] = [];
  const canonicalKeyCache = new Map<string, string | null>();

  const resolveCanonicalKeyCached = (cwd: string) =>
    Effect.gen(function* () {
      const cached = canonicalKeyCache.get(cwd);
      if (cached !== undefined) {
        return cached;
      }
      const resolved = yield* input.resolveCanonicalKey(cwd);
      canonicalKeyCache.set(cwd, resolved);
      return resolved;
    });

  for (const instanceId of instanceIds) {
    const agentDir = resolvePiAgentDir(input.settings, instanceId, pathApi);
    const sessionsRoot = pathApi.join(agentDir, "sessions");
    const sessionsRootExists = yield* fs
      .exists(sessionsRoot)
      .pipe(Effect.orElseSucceed(() => false));
    if (!sessionsRootExists) {
      continue;
    }

    const cwdDirs = yield* fs.readDirectory(sessionsRoot).pipe(Effect.orElseSucceed(() => []));
    for (const cwdDirName of cwdDirs) {
      if (!cwdDirName.startsWith("--")) {
        continue;
      }
      const cwdDirPath = pathApi.join(sessionsRoot, cwdDirName);
      const entries = yield* fs.readDirectory(cwdDirPath).pipe(Effect.orElseSucceed(() => []));
      for (const entryName of entries) {
        if (!entryName.endsWith(".jsonl")) {
          continue;
        }
        const sessionFile = pathApi.join(cwdDirPath, entryName);
        const header = yield* readSessionHeader(sessionFile);
        if (!header?.cwd) {
          continue;
        }
        const sessionCwd = pathApi.resolve(header.cwd);

        let matchReason: PiSessionDiscoveryMatchReason | undefined;
        if (isPathEqualOrUnder(sessionCwd, workspaceRoot)) {
          matchReason = "cwd-prefix";
        } else if (input.projectCanonicalKey) {
          const sessionKey = yield* resolveCanonicalKeyCached(sessionCwd);
          if (sessionKey !== null && sessionKey === input.projectCanonicalKey) {
            matchReason = "git-identity";
          }
        }
        if (!matchReason) {
          continue;
        }

        const parsed = yield* readFullSession(sessionFile);
        if (!parsed || parsed.messages.length === 0) {
          continue;
        }
        // Subagent sessions belong under the parent once T3 has sub-threads.
        if (isPiSubagentSession(parsed)) {
          continue;
        }

        discovered.push({
          ...parsed,
          title: derivePiSessionTitle(parsed),
          matchReason,
          providerInstanceId: instanceId,
        });
      }
    }
  }

  return discovered.toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
});

export function resolvePiAgentDirectoryForInstance(
  settings: ServerSettings,
  instanceId: ProviderInstanceId,
): Effect.Effect<string, never, Path.Path> {
  return Effect.gen(function* () {
    const pathApi = yield* Path.Path;
    return resolvePiAgentDir(settings, instanceId, pathApi);
  });
}
