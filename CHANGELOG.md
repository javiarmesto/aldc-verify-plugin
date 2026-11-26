# Changelog

All notable changes to aldc-verify. Versions follow the `version` in `.claude-plugin/plugin.json`.

## 0.4.0 - 2026-10-21

Standalone release: any Business Central developer can use the plugin, with or without ALDC.

- **Licence:** MIT (`LICENSE`), the same licence as ALDC.
- **Language:** every runtime message (Stop gate, SessionStart, `/al-verify` summary, guard denials, ALDC overlay, `init`) is now in **English by default**. Spanish when `"language": "es"` is set in `.claude/aldc-verify.json`, or `ALDC_VERIFY_LANG=es`, or, when neither is set, the system locale starts with `es`. All strings live in `scripts/lib/messages.js`; their meaning is unchanged.
- **ALDC is optional:** SessionStart only mentions the ALDC conductor flow when an `aldc@…` plugin is installed (`~/.claude/plugins/installed_plugins.json`, or under `CLAUDE_CONFIG_DIR`) or the project has `aldc.yaml`. The SubagentStart overlay still only fires for `aldc:*` agents.
- **`init`:** writes `CLAUDE.md` from `templates/CLAUDE.md` (English) or `templates/CLAUDE.es.md` (Spanish) following the same language rule. The templates no longer say that only the user runs `/al-go`, and drop a project-specific accounting rule.
- **Skills and agent:** report in the user's language instead of always in Spanish; they recognise both the English and the Spanish summary lines (`Status: partial` / `Estado: partial`, `not pinned` / `sin fijar`).
- **Tests:** `tests/` with `node:test`, no dependencies, no AL compiler needed: guard classification, overlay per role, language selection, SessionStart with and without ALDC, and the Stop gate's fast paths. Run with `node --test tests/` or `npm test`.
- **CI:** `.github/workflows/test.yml` runs the tests on ubuntu-latest and windows-latest with Node 20 and 22.
- **Docs:** bilingual README (English, then Spanish) with installation, configuration, guard, CI template, ALDC integration and troubleshooting.

## 0.3.0 - 2026-10-15

Agents ship on their own behind mechanical guardrails.

- `guard.js` (PreToolUse, Bash and PowerShell, AL repos only): denies `gh pr merge`, force and delete pushes, pushes to default branches, mass `git add`, `commit -a` and protected paths; `"guard": false` turns it off.
- `/al-go` can be invoked by the model and no longer waits for a human; it opens a draft PR and never merges.
- `aldc-overlay.js` (SubagentStart `^aldc:`): tells ALDC writers, reviewers, planners and the conductor how to verify with aldc-verify.
- SessionStart context mentions the ALDC flow.

## 0.2.2 - 2026-10-15

Lessons from a second repo (BC 28, ignored symbols, worktree).

- BC major from the main app's `application`; without a pin each project filters symbols by its own major.
- Symbols fall back to `al.packageCachePath`, then to the main checkout (git worktrees).
- `init` reads the default branch from the remote and lists every plans folder.
- Gate releases at once when nothing changed after a block, and tells the model once when a blocked build turns green.

## 0.2.1 - 2026-10-15

- `init` uses the origin repo name and shows the effective pin.

## 0.2.0 - 2026-10-15

Phase 1 complete.

- SubagentStop gate for code-writing subagents, with per-agent attempt counters.
- Per-repo compile lock and private run folders, so concurrent compiles no longer collide.
- `al-build-validator` agent: read-only, errors grouped by root cause.
- Skills `/al-go`, `/al-learn` and `/init`; `init.js` with templates (`CLAUDE.md`, `settings.json`, GitHub Actions `al-compile.yml`) that never overwrite anything.
- `ALDC_VERIFY_DEBUG` traces in the gate.

## 0.1.2 - 2026-10-15

- The state folder writes its own `.gitignore`; green `/al-verify` runs are recorded in the history; per-project warning counts; SessionStart says whether the `al` version is pinned.

## 0.1.1 - 2026-10-15

- L2 on the dotnet tool: analyzers resolved from the tool store; `/al-verify` reports partial when analyzers are missing.
- Gate: no recompile once the release summary was shown for the same tree; bounded event history in `state.json`.

## 0.1.0 - 2026-10-15

First version: verifiable AL loop for Claude Code.

- Stop gate that compiles the AL projects changed in the turn and blocks with diagnostics, at most 3 attempts; not-run instead of blocking when it cannot compile.
- UserPromptSubmit baseline, so a tree that was already red never loops.
- `/al-verify`: L1 compile and L2 analyzers with a grouped summary.
- SessionStart detects `alc` on Windows and installs dotnet 8 and the pinned `al` tool on Linux and in the cloud.
- Per-repo pin in `.claude/aldc-verify.json`.
