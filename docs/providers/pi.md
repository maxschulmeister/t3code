# Pi

This guide is for people who want to use the Pi coding agent in T3 Code.

Pi support is **Early Access** and is disabled by default. You opt in from Settings, and
Pi runs through its own `~/.pi/agent` configuration — the same setup the `pi` CLI uses.

## Before You Start

Install the Pi CLI and make sure it is on your `PATH`:

```bash
pi --version
```

Pi does not have a single `login` command like Codex or Claude. Instead, Pi talks to
upstream model providers (for example Google, Anthropic, or xAI) using per-provider API
keys stored under `~/.pi/agent`. Configure at least one provider with the Pi CLI before
using Pi in T3 Code, then confirm it works:

```bash
pi --list-models
```

If that prints models, Pi is ready.

## Enable Pi In T3 Code

Pi is off by default. Turn it on in Settings.

In Settings, your Pi provider looks like this:

```text
Display name: Pi
Binary path: pi
Auto-import sessions: on
Require tool approval: on
```

An empty (or `pi`) `Binary path` uses the `pi` binary from your `PATH`. Point it at an
absolute path if you run a specific build. **Auto-import sessions** (on by default) pulls
existing Pi CLI sessions into project threads when you enable Pi, on project open, and on
server start.

## Where Pi Keeps Its Config

Pi reads auth, models, and settings from a single directory:

```text
~/.pi/agent/auth.json       upstream provider API keys
~/.pi/agent/models.json     enabled models
~/.pi/agent/settings.json   default provider/model, packages, theme
```

T3 Code uses this directory as-is, so the models and providers you see in T3 Code match
what the `pi` CLI shows.

To point Pi at a different config directory, set `PI_CODING_AGENT_DIR` in the Pi provider's
Environment variables section in Settings. This is the Pi equivalent of a separate home,
and is useful if you want work and personal Pi setups.

## Which Models Are Available?

T3 Code discovers Pi models and slash commands live. When it checks Pi's status, it briefly
starts `pi --mode rpc` and asks Pi for its available models and commands, then appends any
custom models you configured. Result matches model catalog and user commands exposed by your
Pi configuration.

If discovery fails or times out, T3 Code falls back to your custom models only. Enable more
models with the Pi CLI (`pi config`) or by editing `~/.pi/agent/models.json`, then refresh
provider status in Settings.

## Slash Commands

T3 Code loads Pi's RPC commands during provider status checks. Commands from Pi extensions,
prompt templates, and skills appear in composer slash-command menu and run through Pi when
selected. Built-in interactive-only commands such as `/settings` are not exposed because Pi's
RPC mode cannot execute them.

Reload provider status after adding or removing Pi commands so T3 Code refreshes menu.

## How Tool Approval Works

Pi has no built-in per-tool approval prompt, so T3 Code adds one with a small bundled Pi
extension. When **Require tool approval** is on (the default), T3 Code gates every tool
call that is not read-only.

Read-only tools run without asking:

```text
read   grep   find   ls   glob
```

Everything else — including `bash`, `write`, `edit`, and any unknown or custom tool — is
**denied unless you approve it**. This is a default-deny gate: unfamiliar tools are treated
as unsafe rather than trusted.

T3 Code will not run an ungated Pi session. Before allowing a tool-capable turn, it
verifies that the approval extension actually loaded. If the gate cannot be guaranteed
active, T3 Code refuses to start the session rather than run Pi with unguarded tools.

If you turn **Require tool approval** off, Pi runs tools without asking. Only do this in
environments where that is acceptable.

### Advanced: what happens if the gate is unavailable

There is an advanced policy, `onApprovalUnavailable`, that controls what T3 Code does when
tool approval is required but the approval gate cannot be loaded. It defaults to `fail`:

- `fail` — refuse to start the session (default, safest).
- `readOnly` — start Pi with mutating tools (`bash`, `write`, `edit`, `multi_edit`,
  `apply_patch`) disabled, so it can still read and plan.

Neither mode ever runs mutating tools without a gate. This field is not shown in the normal
Settings form; leave it at `fail` unless you have a specific reason to change it.

## Limitations

- **Early Access.** Expect rough edges.
- **Disabled by default.** You must enable Pi in Settings before it appears in the model
  picker.
- **Auth is inferred from model discovery.** Pi has no `login` command, so T3 Code reports
  Pi as authenticated when Pi returns available models (which requires a working provider or
  API key configured in `~/.pi/agent`), and shows a "no models available" warning otherwise.
  An invalid key surfaces as an error when you send a message. Use `pi --list-models` to
  confirm your keys work.
- **Config is shared with the Pi CLI.** Changes you make in `~/.pi/agent` affect both T3
  Code and the `pi` CLI. Use `PI_CODING_AGENT_DIR` to isolate a setup.

## Importing Existing Pi Sessions

When Pi is enabled and **Auto-import sessions** is on (default), T3 Code scans
`~/.pi/agent/sessions/` (or `$PI_CODING_AGENT_DIR/sessions`) and imports matching Pi
sessions as threads:

- On server start (if Pi already enabled)
- When you enable Pi (or turn auto-import on) in Settings
- When you add a project (or change its workspace root)

Match rules:

- Session `cwd` equals or is under the project workspace root, **or**
- Session `cwd` shares the same git remote identity (worktrees elsewhere)

Imported threads get message history from the session JSONL and resume via
`--session <path>` on the next turn. Right-click a project in the sidebar and choose
**Import Pi Sessions** to re-scan manually (works even if auto-import is off).
Already-linked sessions are skipped.

**Subagent sessions** (Pi names like `subagent: scout — …`) are **not** imported as
threads. T3 Code does not have sub-threads yet; those land in a follow-up that mirrors
Pi's parent/child session model. `/fork` and `/clone` sessions still import as normal
threads.

Toggle **Auto-import sessions** under the Pi provider in Settings to disable the automatic
scans without turning Pi off.
