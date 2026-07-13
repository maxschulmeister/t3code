import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  MessageId,
  type ModelSelection,
  PiSettings,
  type ProjectId,
  type ProjectImportPiSessionsInput,
  ProjectImportPiSessionsError,
  type ProjectImportPiSessionsResult,
  ProviderDriverKind,
  type ProviderInstanceId,
  type ServerSettings,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as RepositoryIdentityResolver from "../../project/RepositoryIdentityResolver.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { discoverPiSessionsForProject } from "../PiSessionDiscovery.ts";
import { ProviderSessionDirectory } from "../Services/ProviderSessionDirectory.ts";

const PI_DRIVER = ProviderDriverKind.make("pi");
const decodePiSettings = Schema.decodeSync(PiSettings);

function readSessionFileFromResumeCursor(resumeCursor: unknown): string | undefined {
  if (!resumeCursor || typeof resumeCursor !== "object") return undefined;
  const cursor = resumeCursor as Record<string, unknown>;
  return typeof cursor["sessionFile"] === "string" && cursor["sessionFile"].trim().length > 0
    ? cursor["sessionFile"].trim()
    : undefined;
}

function piThreadId(sessionId: string): ThreadId {
  return ThreadId.make(`pi-session-${sessionId}`);
}

function piMessageId(sessionId: string, entryId: string): MessageId {
  return MessageId.make(`pi-import:${sessionId}:${entryId}`);
}

function piCommandId(sessionId: string, step: string): CommandId {
  return CommandId.make(`pi-import:${sessionId}:${step}`);
}

function listEnabledPiInstances(settings: ServerSettings) {
  return Object.entries(settings.providerInstances).filter(
    ([, instance]) => instance.driver === PI_DRIVER && instance.enabled !== false,
  );
}

/** True when at least one Pi instance is enabled. */
export function isPiProviderEnabled(settings: ServerSettings): boolean {
  return listEnabledPiInstances(settings).length > 0;
}

/**
 * Auto-import is on when Pi is enabled and at least one enabled Pi instance
 * has `autoImportSessions` (defaults to true).
 */
export function shouldAutoImportPiSessions(settings: ServerSettings): boolean {
  const enabledPi = listEnabledPiInstances(settings);
  if (enabledPi.length === 0) {
    return false;
  }
  return enabledPi.some(([, instance]) => {
    const config = decodePiSettings(instance.config ?? {});
    return config.autoImportSessions;
  });
}

function resolveModelSelection(
  session: {
    readonly modelId: string | undefined;
    readonly providerInstanceId: ProviderInstanceId;
  },
  projectDefault: ModelSelection | null | undefined,
): ModelSelection {
  if (session.modelId && session.modelId.trim().length > 0) {
    return {
      instanceId: session.providerInstanceId,
      model: session.modelId.trim(),
    };
  }
  if (projectDefault && projectDefault.instanceId === session.providerInstanceId) {
    return projectDefault;
  }
  if (projectDefault) {
    return projectDefault;
  }
  return {
    instanceId: session.providerInstanceId,
    model: "default",
  };
}

export interface PiSessionImportServiceShape {
  readonly importForProject: (
    input: ProjectImportPiSessionsInput,
  ) => Effect.Effect<ProjectImportPiSessionsResult, ProjectImportPiSessionsError>;
  readonly importForAllProjects: () => Effect.Effect<
    ProjectImportPiSessionsResult,
    ProjectImportPiSessionsError
  >;
}

export class PiSessionImportService extends Context.Service<
  PiSessionImportService,
  PiSessionImportServiceShape
>()("t3/provider/Layers/PiSessionImportService") {}

export const makePiSessionImportService = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const providerSessionDirectory = yield* ProviderSessionDirectory;
  const serverSettings = yield* ServerSettingsService;
  const repositoryIdentityResolver = yield* RepositoryIdentityResolver.RepositoryIdentityResolver;
  const fileSystem = yield* FileSystem.FileSystem;
  const pathApi = yield* Path.Path;

  const importForProject: PiSessionImportServiceShape["importForProject"] = Effect.fn(
    "PiSessionImportService.importForProject",
  )(function* (input) {
    const projectShell = yield* projectionSnapshotQuery.getProjectShellById(input.projectId).pipe(
      Effect.mapError(
        (cause) =>
          new ProjectImportPiSessionsError({
            projectId: input.projectId,
            failure: "import_failed",
            detail: "Failed to load project shell.",
            cause,
          }),
      ),
    );

    if (Option.isNone(projectShell)) {
      return yield* new ProjectImportPiSessionsError({
        projectId: input.projectId,
        failure: "project_not_found",
      });
    }

    const project = projectShell.value;
    const workspaceRoot = project.workspaceRoot?.trim();
    if (!workspaceRoot) {
      return yield* new ProjectImportPiSessionsError({
        projectId: input.projectId,
        failure: "workspace_root_missing",
      });
    }

    const settings = yield* serverSettings.getSettings.pipe(
      Effect.mapError(
        (cause) =>
          new ProjectImportPiSessionsError({
            projectId: input.projectId,
            failure: "import_failed",
            detail: "Failed to load server settings.",
            cause,
          }),
      ),
    );

    const piInstances = listEnabledPiInstances(settings);
    if (piInstances.length === 0) {
      return yield* new ProjectImportPiSessionsError({
        projectId: input.projectId,
        failure: "pi_disabled",
        detail: "No enabled Pi provider instance is configured.",
      });
    }

    const projectIdentity = yield* repositoryIdentityResolver.resolve(workspaceRoot);
    const projectCanonicalKey = projectIdentity?.canonicalKey ?? null;

    const discovered = yield* discoverPiSessionsForProject({
      settings,
      workspaceRoot,
      projectCanonicalKey,
      ...(input.providerInstanceId !== undefined
        ? { providerInstanceId: input.providerInstanceId }
        : {}),
      resolveCanonicalKey: (cwd) =>
        repositoryIdentityResolver.resolve(cwd).pipe(
          Effect.map((identity) => identity?.canonicalKey ?? null),
          Effect.orElseSucceed(() => null),
        ),
    }).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, pathApi),
      Effect.mapError(
        (cause) =>
          new ProjectImportPiSessionsError({
            projectId: input.projectId,
            failure: "import_failed",
            detail: "Failed while scanning Pi sessions.",
            cause,
          }),
      ),
    );

    const existingBindings = yield* providerSessionDirectory.listBindings().pipe(
      Effect.mapError(
        (cause) =>
          new ProjectImportPiSessionsError({
            projectId: input.projectId,
            failure: "import_failed",
            detail: "Failed to list provider session bindings.",
            cause,
          }),
      ),
    );
    const boundSessionFiles = new Set(
      existingBindings
        .map((binding) => readSessionFileFromResumeCursor(binding.resumeCursor))
        .filter((value): value is string => value !== undefined),
    );

    let imported = 0;
    let skipped = 0;
    const threadIds: ThreadId[] = [];

    for (const session of discovered) {
      if (boundSessionFiles.has(session.sessionFile)) {
        skipped += 1;
        continue;
      }

      const threadId = piThreadId(session.sessionId);
      const existingThread = yield* projectionSnapshotQuery.getThreadShellById(threadId).pipe(
        Effect.mapError(
          (cause) =>
            new ProjectImportPiSessionsError({
              projectId: input.projectId,
              failure: "import_failed",
              detail: `Failed to check existing thread for Pi session '${session.sessionId}'.`,
              cause,
            }),
        ),
      );
      if (Option.isSome(existingThread)) {
        // Thread exists (perhaps from a prior partial import) — seed binding if missing.
        const binding = yield* providerSessionDirectory.getBinding(threadId).pipe(
          Effect.mapError(
            (cause) =>
              new ProjectImportPiSessionsError({
                projectId: input.projectId,
                failure: "import_failed",
                detail: "Failed to read provider binding.",
                cause,
              }),
          ),
        );
        if (Option.isNone(binding)) {
          yield* providerSessionDirectory
            .upsert({
              threadId,
              provider: PI_DRIVER,
              providerInstanceId: session.providerInstanceId,
              runtimeMode: DEFAULT_RUNTIME_MODE,
              status: "stopped",
              resumeCursor: { sessionFile: session.sessionFile },
              runtimePayload: {
                cwd: session.cwd ?? workspaceRoot,
                modelSelection: resolveModelSelection(session, project.defaultModelSelection),
                importedFromPi: true,
              },
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new ProjectImportPiSessionsError({
                    projectId: input.projectId,
                    failure: "import_failed",
                    detail: "Failed to seed provider session binding.",
                    cause,
                  }),
              ),
            );
        }
        skipped += 1;
        continue;
      }

      const modelSelection = resolveModelSelection(session, project.defaultModelSelection);
      const createdAt = session.createdAt;
      const worktreePath = session.cwd && session.cwd !== workspaceRoot ? session.cwd.trim() : null;

      yield* orchestrationEngine
        .dispatch({
          type: "thread.create",
          commandId: piCommandId(session.sessionId, "create"),
          threadId,
          projectId: input.projectId,
          title: session.title,
          modelSelection,
          runtimeMode: DEFAULT_RUNTIME_MODE,
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          branch: null,
          worktreePath: worktreePath && worktreePath.length > 0 ? worktreePath : null,
          createdAt,
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new ProjectImportPiSessionsError({
                projectId: input.projectId,
                failure: "import_failed",
                detail: `Failed to create thread for Pi session '${session.sessionId}'.`,
                cause,
              }),
          ),
        );

      yield* providerSessionDirectory
        .upsert({
          threadId,
          provider: PI_DRIVER,
          providerInstanceId: session.providerInstanceId,
          runtimeMode: DEFAULT_RUNTIME_MODE,
          status: "stopped",
          resumeCursor: { sessionFile: session.sessionFile },
          runtimePayload: {
            cwd: session.cwd ?? workspaceRoot,
            modelSelection,
            importedFromPi: true,
          },
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new ProjectImportPiSessionsError({
                projectId: input.projectId,
                failure: "import_failed",
                detail: "Failed to seed provider session binding.",
                cause,
              }),
          ),
        );

      const nowIso = DateTime.formatIso(yield* DateTime.now);
      yield* orchestrationEngine
        .dispatch({
          type: "thread.session.set",
          commandId: piCommandId(session.sessionId, "session-set"),
          threadId,
          session: {
            threadId,
            status: "stopped",
            providerName: "pi",
            providerInstanceId: session.providerInstanceId,
            runtimeMode: DEFAULT_RUNTIME_MODE,
            activeTurnId: null,
            lastError: null,
            updatedAt: nowIso,
          },
          createdAt: nowIso,
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new ProjectImportPiSessionsError({
                projectId: input.projectId,
                failure: "import_failed",
                detail: "Failed to set orchestration session for imported thread.",
                cause,
              }),
          ),
        );

      if (session.messages.length > 0) {
        yield* orchestrationEngine
          .dispatch({
            type: "thread.messages.import",
            commandId: piCommandId(session.sessionId, "messages"),
            threadId,
            messages: session.messages.map((message) => ({
              messageId: piMessageId(session.sessionId, message.entryId),
              role: message.role,
              text: message.text,
              createdAt: message.createdAt,
            })),
            createdAt: nowIso,
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new ProjectImportPiSessionsError({
                  projectId: input.projectId,
                  failure: "import_failed",
                  detail: `Failed to backfill messages for Pi session '${session.sessionId}'.`,
                  cause,
                }),
            ),
          );
      }

      boundSessionFiles.add(session.sessionFile);
      threadIds.push(threadId);
      imported += 1;
    }

    return {
      scanned: discovered.length,
      imported,
      skipped,
      threadIds,
    } satisfies ProjectImportPiSessionsResult;
  });

  const importForAllProjects: PiSessionImportServiceShape["importForAllProjects"] = Effect.fn(
    "PiSessionImportService.importForAllProjects",
  )(function* () {
    const shell = yield* projectionSnapshotQuery.getShellSnapshot().pipe(
      Effect.mapError(
        (cause) =>
          new ProjectImportPiSessionsError({
            failure: "import_failed",
            detail: "Failed to load project shell snapshot.",
            cause,
          }),
      ),
    );

    let scanned = 0;
    let imported = 0;
    let skipped = 0;
    const threadIds: ThreadId[] = [];

    for (const project of shell.projects) {
      if (!project.workspaceRoot?.trim()) {
        continue;
      }
      const result = yield* importForProject({ projectId: project.id }).pipe(
        Effect.catchTag("ProjectImportPiSessionsError", (error) => {
          if (error.failure === "pi_disabled" || error.failure === "workspace_root_missing") {
            return Effect.succeed({
              scanned: 0,
              imported: 0,
              skipped: 0,
              threadIds: [] as ReadonlyArray<ThreadId>,
            });
          }
          return Effect.logWarning("pi session import skipped project", {
            projectId: project.id,
            failure: error.failure,
            detail: error.detail ?? error.message,
          }).pipe(
            Effect.as({
              scanned: 0,
              imported: 0,
              skipped: 0,
              threadIds: [] as ReadonlyArray<ThreadId>,
            }),
          );
        }),
      );
      scanned += result.scanned;
      imported += result.imported;
      skipped += result.skipped;
      threadIds.push(...result.threadIds);
    }

    return { scanned, imported, skipped, threadIds } satisfies ProjectImportPiSessionsResult;
  });

  return { importForProject, importForAllProjects } satisfies PiSessionImportServiceShape;
});

export const PiSessionImportServiceLive = Layer.effect(
  PiSessionImportService,
  makePiSessionImportService,
);

/** Helper for auto-import reactor: import by project id without throwing for soft skips. */
export const importPiSessionsForProjectId = (
  projectId: ProjectId,
  providerInstanceId?: ProviderInstanceId,
) =>
  Effect.gen(function* () {
    const service = yield* PiSessionImportService;
    return yield* service.importForProject({
      projectId,
      ...(providerInstanceId !== undefined ? { providerInstanceId } : {}),
    });
  });
