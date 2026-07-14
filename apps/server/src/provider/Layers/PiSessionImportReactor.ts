import type { OrchestrationEvent, ProjectId, ServerSettings } from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { PiSessionImportService, shouldAutoImportPiSessions } from "./PiSessionImportService.ts";

type ProjectWorkspaceEvent = Extract<
  OrchestrationEvent,
  { type: "project.created" | "project.meta-updated" }
>;

type ImportJob =
  | { readonly kind: "project"; readonly event: ProjectWorkspaceEvent }
  | { readonly kind: "all-projects"; readonly reason: "startup" | "settings" };

export interface PiSessionImportReactorShape {
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
}

export class PiSessionImportReactor extends Context.Service<
  PiSessionImportReactor,
  PiSessionImportReactorShape
>()("t3/provider/Layers/PiSessionImportReactor") {}

function projectIdFromEvent(event: ProjectWorkspaceEvent): ProjectId | undefined {
  return event.payload.projectId;
}

function workspaceRootFromEvent(event: ProjectWorkspaceEvent): string | undefined {
  return event.payload.workspaceRoot;
}

export const makePiSessionImportReactor = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const importService = yield* PiSessionImportService;
  const serverSettings = yield* ServerSettingsService;

  const importAllSafely = Effect.fn("PiSessionImportReactor.importAllSafely")(function* (
    reason: "startup" | "settings",
  ) {
    const result = yield* importService.importForAllProjects().pipe(
      Effect.catchTag("ProjectImportPiSessionsError", (error) => {
        if (error.failure === "pi_disabled") {
          return Effect.succeed(null);
        }
        return Effect.logWarning("pi session auto-import (all projects) failed", {
          reason,
          failure: error.failure,
          detail: error.detail ?? error.message,
        }).pipe(Effect.as(null));
      }),
    );

    if (result && result.imported > 0) {
      yield* Effect.logInfo("pi session auto-import (all projects) completed", {
        reason,
        imported: result.imported,
        skipped: result.skipped,
        scanned: result.scanned,
      });
    }
  });

  const processProjectEvent = Effect.fn("PiSessionImportReactor.processProjectEvent")(function* (
    event: ProjectWorkspaceEvent,
  ) {
    const projectId = projectIdFromEvent(event);
    const workspaceRoot = workspaceRootFromEvent(event)?.trim();
    if (!projectId || !workspaceRoot) {
      return;
    }

    const settings = yield* serverSettings.getSettings.pipe(
      Effect.catch(() => Effect.succeed(null as ServerSettings | null)),
    );
    if (!settings || !shouldAutoImportPiSessions(settings)) {
      return;
    }

    const result = yield* importService.importForProject({ projectId }).pipe(
      Effect.catchTag("ProjectImportPiSessionsError", (error) => {
        if (error.failure === "pi_disabled") {
          return Effect.succeed(null);
        }
        return Effect.logWarning("pi session auto-import failed", {
          projectId,
          failure: error.failure,
          detail: error.detail ?? error.message,
        }).pipe(Effect.as(null));
      }),
    );

    if (result && result.imported > 0) {
      yield* Effect.logInfo("pi session auto-import completed", {
        projectId,
        imported: result.imported,
        skipped: result.skipped,
        scanned: result.scanned,
      });
    }
  });

  const processJob = Effect.fn("PiSessionImportReactor.processJob")(function* (job: ImportJob) {
    if (job.kind === "all-projects") {
      yield* importAllSafely(job.reason);
      return;
    }
    yield* processProjectEvent(job.event);
  });

  const processSafely = (job: ImportJob) =>
    processJob(job).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("pi session import reactor failed", {
          jobKind: job.kind,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processSafely);

  const start: PiSessionImportReactorShape["start"] = Effect.fn("PiSessionImportReactor.start")(
    function* () {
      // Startup: import all projects if Pi is already enabled with auto-import on.
      const initialSettings = yield* serverSettings.getSettings.pipe(
        Effect.catch(() => Effect.succeed(null as ServerSettings | null)),
      );
      if (initialSettings && shouldAutoImportPiSessions(initialSettings)) {
        yield* worker.enqueue({ kind: "all-projects", reason: "startup" });
      }

      let previousEligible = initialSettings ? shouldAutoImportPiSessions(initialSettings) : false;

      yield* Effect.forkScoped(
        Stream.runForEach(serverSettings.streamChanges, (next) => {
          const nowEligible = shouldAutoImportPiSessions(next);
          const becameEligible = !previousEligible && nowEligible;
          previousEligible = nowEligible;
          if (becameEligible) {
            return worker.enqueue({ kind: "all-projects", reason: "settings" });
          }
          return Effect.void;
        }),
      );

      yield* Effect.forkScoped(
        Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
          if (event.type === "project.created") {
            return worker.enqueue({ kind: "project", event });
          }
          if (event.type === "project.meta-updated" && event.payload.workspaceRoot) {
            return worker.enqueue({ kind: "project", event });
          }
          return Effect.void;
        }),
      );
    },
  );

  return { start } satisfies PiSessionImportReactorShape;
});

export const PiSessionImportReactorLive = Layer.effect(
  PiSessionImportReactor,
  makePiSessionImportReactor,
);
