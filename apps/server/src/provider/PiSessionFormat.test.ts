import { describe, expect, it } from "vite-plus/test";

import {
  derivePiSessionTitle,
  encodePiSessionDirName,
  isPathEqualOrUnder,
  isPiSubagentSession,
  parsePiSessionHeaderLine,
  parsePiSessionJsonl,
} from "./PiSessionFormat.ts";

describe("PiSessionFormat", () => {
  it("encodes cwd directory names the way Pi does", () => {
    expect(encodePiSessionDirName("/Users/max/Documents/t3code")).toBe(
      "--Users-max-Documents-t3code--",
    );
  });

  it("parses session headers", () => {
    const header = parsePiSessionHeaderLine(
      JSON.stringify({
        type: "session",
        version: 3,
        id: "019f5d5a-7b9c-7cb0-b2d8-48adbd4f5f10",
        timestamp: "2026-07-13T21:20:38.812Z",
        cwd: "/Users/max/Documents/t3code",
      }),
    );
    expect(header).toEqual({
      type: "session",
      version: 3,
      id: "019f5d5a-7b9c-7cb0-b2d8-48adbd4f5f10",
      timestamp: "2026-07-13T21:20:38.812Z",
      cwd: "/Users/max/Documents/t3code",
    });
  });

  it("walks the leaf path and extracts user/assistant text", () => {
    const jsonl = [
      JSON.stringify({
        type: "session",
        version: 3,
        id: "sess-1",
        timestamp: "2026-07-13T21:00:00.000Z",
        cwd: "/Users/max/Documents/t3code",
      }),
      JSON.stringify({
        type: "session_info",
        id: "info1",
        parentId: null,
        timestamp: "2026-07-13T21:00:01.000Z",
        name: "Fix PATH bug",
      }),
      JSON.stringify({
        type: "model_change",
        id: "model1",
        parentId: "info1",
        timestamp: "2026-07-13T21:00:02.000Z",
        provider: "cursor",
        modelId: "grok-4.5",
      }),
      JSON.stringify({
        type: "message",
        id: "u1",
        parentId: "model1",
        timestamp: "2026-07-13T21:00:03.000Z",
        message: { role: "user", content: "hello world", timestamp: 1_752_444_003_000 },
      }),
      JSON.stringify({
        type: "message",
        id: "a1",
        parentId: "u1",
        timestamp: "2026-07-13T21:00:04.000Z",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "..." },
            { type: "text", text: "hi there" },
          ],
          model: "grok-4.5",
          timestamp: 1_752_444_004_000,
        },
      }),
      JSON.stringify({
        type: "message",
        id: "t1",
        parentId: "a1",
        timestamp: "2026-07-13T21:00:05.000Z",
        message: {
          role: "toolResult",
          content: [{ type: "text", text: "ignored" }],
          timestamp: 1_752_444_005_000,
        },
      }),
      // Abandoned branch — should not appear on leaf path
      JSON.stringify({
        type: "message",
        id: "u-branch",
        parentId: "u1",
        timestamp: "2026-07-13T21:00:06.000Z",
        message: { role: "user", content: "abandoned", timestamp: 1_752_444_006_000 },
      }),
      // Current leaf continues from a1
      JSON.stringify({
        type: "message",
        id: "u2",
        parentId: "a1",
        timestamp: "2026-07-13T21:00:07.000Z",
        message: { role: "user", content: "next turn", timestamp: 1_752_444_007_000 },
      }),
    ].join("\n");

    const parsed = parsePiSessionJsonl("/tmp/sess.jsonl", jsonl);
    expect(parsed).toBeDefined();
    expect(parsed!.name).toBe("Fix PATH bug");
    expect(parsed!.parentSession).toBeUndefined();
    expect(parsed!.modelId).toBe("grok-4.5");
    expect(parsed!.modelProvider).toBe("cursor");
    expect(parsed!.messages.map((message) => message.text)).toEqual([
      "hello world",
      "hi there",
      "next turn",
    ]);
    expect(derivePiSessionTitle(parsed!)).toBe("Fix PATH bug");
  });

  it("matches cwd under project root", () => {
    expect(isPathEqualOrUnder("/Users/max/Documents/t3code", "/Users/max/Documents/t3code")).toBe(
      true,
    );
    expect(
      isPathEqualOrUnder("/Users/max/Documents/t3code/apps", "/Users/max/Documents/t3code"),
    ).toBe(true);
    expect(isPathEqualOrUnder("/Users/max/Documents/other", "/Users/max/Documents/t3code")).toBe(
      false,
    );
  });

  it("detects subagent sessions by name prefix only", () => {
    expect(
      isPiSubagentSession({
        name: "subagent: scout — Find DMG steps",
      }),
    ).toBe(true);
    expect(isPiSubagentSession({ name: "Subagent: Reviewer" })).toBe(true);
    expect(isPiSubagentSession({ name: "Refactor auth" })).toBe(false);
    expect(isPiSubagentSession({ name: undefined })).toBe(false);
  });
});
