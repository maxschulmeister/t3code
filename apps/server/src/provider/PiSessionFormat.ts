/**
 * Pure helpers for reading Pi coding-agent session JSONL files.
 *
 * Session layout (see `@earendil-works/pi-coding-agent` docs/session-format.md):
 *   ~/.pi/agent/sessions/--<cwd-with-slashes-as-dashes>--/<timestamp>_<uuid>.jsonl
 *
 * Entries form a tree via `id`/`parentId`. The current leaf is the last entry
 * in the file; context is the root→leaf path.
 */

import * as DateTime from "effect/DateTime";

export type PiSessionHeader = {
  readonly type: "session";
  readonly version?: number;
  readonly id: string;
  readonly timestamp: string;
  readonly cwd?: string;
  readonly parentSession?: string;
};

export type PiSessionMessageRole = "user" | "assistant" | "toolResult" | "other";

export type PiImportedChatMessage = {
  readonly entryId: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly createdAt: string;
  readonly modelId?: string;
};

export type PiParsedSession = {
  readonly sessionFile: string;
  readonly sessionId: string;
  readonly cwd: string | undefined;
  readonly createdAt: string;
  readonly name: string | undefined;
  /** Absolute path to parent session file when forked/cloned/subagent. */
  readonly parentSession: string | undefined;
  readonly modelId: string | undefined;
  readonly modelProvider: string | undefined;
  readonly messages: ReadonlyArray<PiImportedChatMessage>;
};

type PiTreeEntry = {
  readonly type: string;
  readonly id: string;
  readonly parentId: string | null;
  readonly timestamp: string;
  readonly raw: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const parts: string[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block["type"] === "text" && typeof block["text"] === "string") {
      parts.push(block["text"]);
    }
  }
  return parts.join("\n").trim();
}

function messageRole(message: Record<string, unknown>): PiSessionMessageRole {
  const role = message["role"];
  if (role === "user" || role === "assistant" || role === "toolResult") {
    return role;
  }
  return "other";
}

/**
 * Encode a workspace path the way Pi names session directories:
 * `/Users/foo/bar` → `--Users-foo-bar--`
 */
export function encodePiSessionDirName(cwd: string): string {
  const normalized = cwd.replaceAll("\\", "/").replace(/\/+$/, "").replace(/^\//, "");
  return `--${normalized.replaceAll("/", "-")}--`;
}

export function parsePiSessionHeaderLine(line: string): PiSessionHeader | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || parsed["type"] !== "session") {
    return undefined;
  }
  const id = parsed["id"];
  const timestamp = parsed["timestamp"];
  if (typeof id !== "string" || id.trim().length === 0) {
    return undefined;
  }
  if (typeof timestamp !== "string" || timestamp.trim().length === 0) {
    return undefined;
  }
  return {
    type: "session",
    id: id.trim(),
    timestamp: timestamp.trim(),
    ...(typeof parsed["version"] === "number" ? { version: parsed["version"] } : {}),
    ...(typeof parsed["cwd"] === "string" ? { cwd: parsed["cwd"] } : {}),
    ...(typeof parsed["parentSession"] === "string"
      ? { parentSession: parsed["parentSession"] }
      : {}),
  };
}

/**
 * Walk the leaf→root path of a Pi session JSONL and extract user/assistant
 * text messages suitable for T3 thread backfill.
 */
export function parsePiSessionJsonl(
  sessionFile: string,
  contents: string,
): PiParsedSession | undefined {
  const lines = contents.split("\n");
  let header: PiSessionHeader | undefined;
  const entries: PiTreeEntry[] = [];
  let sessionName: string | undefined;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(parsed)) continue;

    if (parsed["type"] === "session") {
      header = parsePiSessionHeaderLine(line);
      continue;
    }

    if (parsed["type"] === "session_info" && typeof parsed["name"] === "string") {
      const name = parsed["name"].trim();
      if (name.length > 0) {
        sessionName = name;
      }
    }

    const id = parsed["id"];
    if (typeof id !== "string" || id.trim().length === 0) {
      continue;
    }
    const parentId =
      parsed["parentId"] === null
        ? null
        : typeof parsed["parentId"] === "string"
          ? parsed["parentId"]
          : null;
    const timestamp =
      typeof parsed["timestamp"] === "string" && parsed["timestamp"].trim().length > 0
        ? parsed["timestamp"].trim()
        : (header?.timestamp ?? "1970-01-01T00:00:00.000Z");

    entries.push({
      type: typeof parsed["type"] === "string" ? parsed["type"] : "unknown",
      id: id.trim(),
      parentId,
      timestamp,
      raw: parsed,
    });
  }

  if (!header) {
    return undefined;
  }

  // Current leaf = last entry in the file (Pi appends to the active branch).
  const leaf = entries.at(-1);
  const pathEntries: PiTreeEntry[] = [];
  if (leaf) {
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    let current: PiTreeEntry | undefined = leaf;
    const seen = new Set<string>();
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      pathEntries.push(current);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    pathEntries.reverse();
  }

  let modelId: string | undefined;
  let modelProvider: string | undefined;
  const messages: PiImportedChatMessage[] = [];

  for (const entry of pathEntries) {
    if (entry.type === "model_change") {
      if (typeof entry.raw["modelId"] === "string" && entry.raw["modelId"].trim().length > 0) {
        modelId = entry.raw["modelId"].trim();
      }
      if (typeof entry.raw["provider"] === "string" && entry.raw["provider"].trim().length > 0) {
        modelProvider = entry.raw["provider"].trim();
      }
      continue;
    }

    if (entry.type !== "message") continue;
    const message = entry.raw["message"];
    if (!isRecord(message)) continue;
    const role = messageRole(message);
    if (role !== "user" && role !== "assistant") continue;
    const text = extractTextContent(message["content"]);
    if (text.length === 0) continue;

    const createdAt =
      typeof message["timestamp"] === "number" && Number.isFinite(message["timestamp"])
        ? DateTime.formatIso(DateTime.makeUnsafe(message["timestamp"]))
        : entry.timestamp;

    messages.push({
      entryId: entry.id,
      role,
      text,
      createdAt,
      ...(role === "assistant" && typeof message["model"] === "string"
        ? { modelId: message["model"] }
        : {}),
    });
  }

  return {
    sessionFile,
    sessionId: header.id,
    cwd: header.cwd,
    createdAt: header.timestamp,
    name: sessionName,
    parentSession: header.parentSession,
    modelId,
    modelProvider,
    messages,
  };
}

/**
 * Pi subagent sessions are named `subagent: <role> — <task>…`.
 * T3 has no sub-thread model yet — skip these on import so a later parity PR
 * can attach them under the parent without migrating orphan flat threads.
 * `/fork` and `/clone` also set `parentSession` but use other names — keep those.
 */
export function isPiSubagentSession(session: { readonly name: string | undefined }): boolean {
  const name = session.name?.trim().toLowerCase();
  return name !== undefined && name.startsWith("subagent:");
}

export function derivePiSessionTitle(session: PiParsedSession): string {
  if (session.name && session.name.trim().length > 0) {
    return session.name.trim().slice(0, 120);
  }
  const firstUser = session.messages.find((message) => message.role === "user");
  if (firstUser) {
    const collapsed = firstUser.text.replace(/\s+/g, " ").trim();
    if (collapsed.length > 0) {
      return collapsed.slice(0, 80);
    }
  }
  return `Pi session ${session.sessionId.slice(0, 8)}`;
}

export function isPathEqualOrUnder(candidate: string, root: string): boolean {
  const normalizedCandidate = candidate.replaceAll("\\", "/").replace(/\/+$/, "");
  const normalizedRoot = root.replaceAll("\\", "/").replace(/\/+$/, "");
  if (normalizedCandidate.length === 0 || normalizedRoot.length === 0) {
    return false;
  }
  if (normalizedCandidate === normalizedRoot) {
    return true;
  }
  return normalizedCandidate.startsWith(`${normalizedRoot}/`);
}
