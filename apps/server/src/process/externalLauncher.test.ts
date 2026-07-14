import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { SpawnExecutableResolution } from "@t3tools/shared/shell";
import * as ExternalLauncher from "./externalLauncher.ts";

function makeMockDetachedHandle(
  onUnref: () => void = () => undefined,
  stdout: Stream.Stream<Uint8Array> = Stream.empty,
) {
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
    isRunning: Effect.succeed(true),
    kill: () => Effect.void,
    unref: Effect.sync(() => {
      onUnref();
      return Effect.void;
    }),
    stdin: Sink.drain,
    stdout,
    stderr: Stream.empty,
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });
}

const testLayer = (input: {
  readonly platform: NodeJS.Platform;
  readonly env?: Record<string, string>;
  readonly resolveExecutable?: (command: string) => string | undefined;
  readonly onSpawn?: (command: ChildProcess.StandardCommand) => void;
  readonly onUnref?: () => void;
  readonly stdout?: string;
}) => {
  const spawnerLayer = Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) =>
      Effect.sync(() => {
        assert.equal(ChildProcess.isStandardCommand(command), true);
        if (!ChildProcess.isStandardCommand(command)) {
          throw new Error("Expected a standard command");
        }
        input.onSpawn?.(command);
        return makeMockDetachedHandle(
          input.onUnref,
          input.stdout === undefined
            ? Stream.empty
            : Stream.make(new TextEncoder().encode(input.stdout)),
        );
      }),
    ),
  );

  return Layer.mergeAll(
    ExternalLauncher.layer.pipe(Layer.provide(Layer.merge(NodeServices.layer, spawnerLayer))),
    Layer.succeed(HostProcessPlatform, input.platform),
    Layer.succeed(
      SpawnExecutableResolution,
      (command) => input.resolveExecutable?.(command) ?? command,
    ),
    ConfigProvider.layer(ConfigProvider.fromEnv({ env: input.env ?? {} })),
  );
};

it.effect("launches the default browser through the platform command", () => {
  let spawned: ChildProcess.StandardCommand | undefined;
  let didUnref = false;
  return Effect.gen(function* () {
    const launcher = yield* ExternalLauncher.ExternalLauncher;

    yield* launcher.launchBrowser("https://example.com/some path");

    assert.ok(spawned);
    assert.equal(spawned.command, "xdg-open");
    assert.deepEqual(spawned.args, ["https://example.com/some path"]);
    assert.equal(spawned.options.detached, true);
    assert.equal(didUnref, true);
  }).pipe(
    Effect.provide(
      testLayer({
        platform: "linux",
        onSpawn: (command) => {
          spawned = command;
        },
        onUnref: () => {
          didUnref = true;
        },
      }),
    ),
  );
});

it.effect("selects a macOS application starting in Applications", () => {
  let spawned: ChildProcess.StandardCommand | undefined;
  return Effect.gen(function* () {
    const launcher = yield* ExternalLauncher.ExternalLauncher;
    const result = yield* launcher.selectCustomApplication();

    assert.deepEqual(result, {
      application: {
        id: "/Applications/Visual Studio Code.app",
        path: "/Applications/Visual Studio Code.app",
        name: "Visual Studio Code",
      },
    });
    assert.ok(spawned);
    assert.equal(spawned.command, "osascript");
    assert.equal(spawned.args[0], "-e");
    assert.match(spawned.args[1] ?? "", /path to applications folder/);
    assert.equal(spawned.options.shell, false);
  }).pipe(
    Effect.provide(
      testLayer({
        platform: "darwin",
        stdout: "/Applications/Visual Studio Code.app/\n",
        onSpawn: (command) => {
          spawned = command;
        },
      }),
    ),
  );
});

it.effect("rejects custom application operations on unsupported platforms", () =>
  Effect.gen(function* () {
    const launcher = yield* ExternalLauncher.ExternalLauncher;
    const error = yield* launcher.selectCustomApplication().pipe(Effect.flip);
    assert.instanceOf(error, ExternalLauncher.ExternalLauncherUnsupportedPlatformError);
    assert.equal(error.platform, "linux");
  }).pipe(Effect.provide(testLayer({ platform: "linux" }))),
);

it.effect("launches a selected macOS application with argv, not a shell", () => {
  let spawned: ChildProcess.StandardCommand | undefined;
  return Effect.gen(function* () {
    const launcher = yield* ExternalLauncher.ExternalLauncher;
    yield* launcher.launchEditor({
      cwd: "/tmp/workspace; touch /tmp/injected",
      editor: {
        id: "/Applications/Custom Editor.app",
        path: "/Applications/Custom Editor.app",
        name: "Custom Editor",
      },
    });

    assert.ok(spawned);
    assert.equal(spawned.command, "open");
    assert.deepEqual(spawned.args, [
      "-a",
      "/Applications/Custom Editor.app",
      "/tmp/workspace; touch /tmp/injected",
    ]);
    assert.equal(spawned.options.shell, false);
  }).pipe(
    Effect.provide(
      testLayer({
        platform: "darwin",
        resolveExecutable: () => "/usr/bin/open",
        onSpawn: (command) => {
          spawned = command;
        },
      }),
    ),
  );
});

it.effect("launches an installed editor with platform-safe arguments", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const binDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-editors-" });
    yield* fileSystem.writeFileString(path.join(binDir, "code.CMD"), "@echo off\r\n");

    let spawned: ChildProcess.StandardCommand | undefined;
    yield* Effect.gen(function* () {
      const launcher = yield* ExternalLauncher.ExternalLauncher;
      yield* launcher.launchEditor({
        editor: "vscode",
        cwd: "C:\\workspace with spaces\\src\\index.ts:12:4",
      });
    }).pipe(
      Effect.provide(
        testLayer({
          platform: "win32",
          env: { PATH: binDir, PATHEXT: ".COM;.EXE;.BAT;.CMD" },
          resolveExecutable: (command) =>
            command === "code" ? "C:\\Program Files\\Microsoft VS Code\\bin\\code.CMD" : command,
          onSpawn: (command) => {
            spawned = command;
          },
        }),
      ),
    );

    assert.ok(spawned);
    assert.equal(spawned.command, '^"C:\\Program^ Files\\Microsoft^ VS^ Code\\bin\\code.CMD^"');
    assert.deepEqual(spawned.args, [
      '^"--goto^"',
      '^"C:\\workspace^ with^ spaces\\src\\index.ts:12:4^"',
    ]);
    assert.equal(spawned.options.shell, true);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("discovers editors through the service API", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const binDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-editors-" });
    yield* fileSystem.writeFileString(path.join(binDir, "code.CMD"), "@echo off\r\n");
    yield* fileSystem.writeFileString(path.join(binDir, "explorer.CMD"), "@echo off\r\n");

    const editors = yield* Effect.gen(function* () {
      const launcher = yield* ExternalLauncher.ExternalLauncher;
      return yield* launcher.resolveAvailableEditors();
    }).pipe(
      Effect.provide(
        testLayer({
          platform: "win32",
          env: { PATH: binDir, PATHEXT: ".COM;.EXE;.BAT;.CMD" },
        }),
      ),
    );

    assert.equal(editors.includes("vscode"), true);
    assert.equal(editors.includes("file-manager"), true);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("rejects unknown editors through the service API", () =>
  Effect.gen(function* () {
    const launcher = yield* ExternalLauncher.ExternalLauncher;
    const error = yield* launcher
      .launchEditor({ editor: "missing-editor" as never, cwd: "/tmp/workspace" })
      .pipe(Effect.flip);
    assert.instanceOf(error, ExternalLauncher.ExternalLauncherUnknownEditorError);
    assert.equal(error.editor, "missing-editor");
    assert.equal(error.message, "Unknown editor: missing-editor");
  }).pipe(Effect.provide(testLayer({ platform: "linux", env: { PATH: "" } }))),
);
