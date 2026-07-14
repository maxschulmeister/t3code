import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";

import { type ModelSelection, type PiSettings, TextGenerationError } from "@t3tools/contracts";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@t3tools/shared/git";
import { extractJsonObject } from "@t3tools/shared/schemaJson";

import {
  extractLastAssistantText,
  makePiRpcTransport,
  piResponseSucceeded,
  resolvePiThinkingLevel,
} from "../provider/Layers/PiRpcClient.ts";
import * as TextGeneration from "./TextGeneration.ts";
import {
  buildBranchNamePrompt,
  buildColorThemePrompt,
  buildCommitMessagePrompt,
  buildPrContentPrompt,
  buildThreadTitlePrompt,
} from "./TextGenerationPrompts.ts";
import {
  sanitizeCommitSubject,
  sanitizePrTitle,
  sanitizeThreadTitle,
  toJsonSchemaObject,
} from "./TextGenerationUtils.ts";

const PI_TIMEOUT_MS = 180_000;
const RPC_REQUEST_TIMEOUT_MS = 30_000;

type TextGenOperation =
  | "generateCommitMessage"
  | "generatePrContent"
  | "generateBranchName"
  | "generateThreadTitle"
  | "generateColorTheme";

const encodeJsonString = Schema.encodeEffect(Schema.UnknownFromJsonString);
const isTextGenerationError = Schema.is(TextGenerationError);

export const makePiTextGeneration = Effect.fn("makePiTextGeneration")(function* (
  piSettings: PiSettings,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const commandSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const runPiPrompt = (input: {
    readonly message: string;
    readonly cwd: string;
    readonly modelSelection: ModelSelection;
    readonly operation: TextGenOperation;
  }): Effect.Effect<string, TextGenerationError> =>
    Effect.gen(function* () {
      const transport = yield* makePiRpcTransport({
        binaryPath: piSettings.binaryPath || "pi",
        args: [
          "--mode",
          "rpc",
          "--no-session",
          "--no-tools",
          ...(resolvePiThinkingLevel(input.modelSelection)
            ? ["--thinking", resolvePiThinkingLevel(input.modelSelection)!]
            : []),
          ...(input.modelSelection.model ? ["--model", input.modelSelection.model] : []),
        ],
        cwd: input.cwd,
        env: environment,
        onExit: Effect.void,
      });
      const promptResponse = yield* transport.request(
        { type: "prompt", message: input.message },
        "pi-textgen-prompt",
        RPC_REQUEST_TIMEOUT_MS,
      );
      if (promptResponse === undefined) {
        return yield* new TextGenerationError({
          operation: input.operation,
          detail:
            "Pi did not accept the text-generation prompt before the process exited or timed out.",
        });
      }
      if (!piResponseSucceeded(promptResponse, "prompt")) {
        const error = (promptResponse as { readonly error?: unknown }).error;
        return yield* new TextGenerationError({
          operation: input.operation,
          detail: `Pi rejected text-generation prompt${typeof error === "string" ? `: ${error}` : "."}`,
        });
      }
      yield* Stream.fromQueue(transport.messages).pipe(
        Stream.takeUntil(
          (message) =>
            message._tag === "event" &&
            (message.event as { readonly type: string }).type === "agent_settled",
        ),
        Stream.runDrain,
      );
      const response = yield* transport.request(
        { type: "get_last_assistant_text" },
        "pi-textgen-last-text",
        RPC_REQUEST_TIMEOUT_MS,
      );
      return extractLastAssistantText(response) ?? "";
    }).pipe(
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, commandSpawner),
      Effect.scoped,
      Effect.timeoutOption(PI_TIMEOUT_MS),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              new TextGenerationError({
                operation: input.operation,
                detail: "Pi request timed out.",
              }),
            ),
          onSome: (value) => Effect.succeed(value),
        }),
      ),
      Effect.mapError((cause) =>
        isTextGenerationError(cause)
          ? cause
          : new TextGenerationError({
              operation: input.operation,
              detail: "Pi RPC request failed.",
              cause,
            }),
      ),
    );

  const runPiJson = Effect.fn("runPiJson")(function* <S extends Schema.Top>({
    operation,
    cwd,
    prompt,
    outputSchemaJson,
    modelSelection,
  }: {
    operation: TextGenOperation;
    cwd: string;
    prompt: string;
    outputSchemaJson: S;
    modelSelection: ModelSelection;
  }): Effect.fn.Return<S["Type"], TextGenerationError, S["DecodingServices"]> {
    const schemaJson = yield* encodeJsonString(toJsonSchemaObject(outputSchemaJson)).pipe(
      Effect.mapError(
        (cause) =>
          new TextGenerationError({
            operation,
            detail: "Failed to encode structured output schema.",
            cause,
          }),
      ),
    );

    const rawResult = yield* runPiPrompt({
      message:
        `${prompt}\n\nRespond ONLY with minified JSON matching this schema. ` +
        `No markdown, no code fences, no prose:\n${schemaJson}`,
      cwd,
      modelSelection,
      operation,
    });

    const decodeOutput = Schema.decodeEffect(Schema.fromJsonString(outputSchemaJson));
    return yield* decodeOutput(extractJsonObject(rawResult)).pipe(
      Effect.catchTags({
        SchemaError: (cause) =>
          Effect.fail(
            new TextGenerationError({
              operation,
              detail: "Pi returned invalid structured output.",
              cause,
            }),
          ),
      }),
    );
  });

  const generateCommitMessage: TextGeneration.TextGeneration["Service"]["generateCommitMessage"] =
    Effect.fn("PiTextGeneration.generateCommitMessage")(function* (input) {
      const { prompt, outputSchema } = buildCommitMessagePrompt({
        branch: input.branch,
        stagedSummary: input.stagedSummary,
        stagedPatch: input.stagedPatch,
        includeBranch: input.includeBranch === true,
      });
      const generated = yield* runPiJson({
        operation: "generateCommitMessage",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });
      return {
        subject: sanitizeCommitSubject(generated.subject),
        body: generated.body.trim(),
        ...("branch" in generated && typeof generated.branch === "string"
          ? { branch: sanitizeFeatureBranchName(generated.branch) }
          : {}),
      };
    });

  const generatePrContent: TextGeneration.TextGeneration["Service"]["generatePrContent"] =
    Effect.fn("PiTextGeneration.generatePrContent")(function* (input) {
      const { prompt, outputSchema } = buildPrContentPrompt({
        baseBranch: input.baseBranch,
        headBranch: input.headBranch,
        commitSummary: input.commitSummary,
        diffSummary: input.diffSummary,
        diffPatch: input.diffPatch,
      });
      const generated = yield* runPiJson({
        operation: "generatePrContent",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });
      return {
        title: sanitizePrTitle(generated.title),
        body: generated.body.trim(),
      };
    });

  const generateBranchName: TextGeneration.TextGeneration["Service"]["generateBranchName"] =
    Effect.fn("PiTextGeneration.generateBranchName")(function* (input) {
      const { prompt, outputSchema } = buildBranchNamePrompt({
        message: input.message,
        attachments: input.attachments,
        existingBranchNames: input.existingBranchNames,
      });
      const generated = yield* runPiJson({
        operation: "generateBranchName",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });
      return { branch: sanitizeBranchFragment(generated.branch) };
    });

  const generateThreadTitle: TextGeneration.TextGeneration["Service"]["generateThreadTitle"] =
    Effect.fn("PiTextGeneration.generateThreadTitle")(function* (input) {
      const { prompt, outputSchema } = buildThreadTitlePrompt({
        message: input.message,
        attachments: input.attachments,
      });
      const generated = yield* runPiJson({
        operation: "generateThreadTitle",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });
      return { title: sanitizeThreadTitle(generated.title) };
    });

  const generateColorTheme: TextGeneration.TextGeneration["Service"]["generateColorTheme"] =
    Effect.fn("PiTextGeneration.generateColorTheme")(function* (input) {
      const { prompt, outputSchema } = buildColorThemePrompt({
        prompt: input.prompt,
        preferredAppearance: input.preferredAppearance,
      });
      const generated = yield* runPiJson({
        operation: "generateColorTheme",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });
      return { theme: generated };
    });

  return {
    generateCommitMessage,
    generatePrContent,
    generateBranchName,
    generateThreadTitle,
    generateColorTheme,
  } satisfies TextGeneration.TextGeneration["Service"];
});
