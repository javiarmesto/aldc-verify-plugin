---
name: al-verify
description: Compile the repo's Business Central AL projects (L1) and run the code analyzers (L2), returning a short grouped summary of errors and warnings. Use after changing AL code, before saying work is done, or when the user asks to build, compile, check or verify AL.
argument-hint: "[--l1] [--project <name|folder>]"
allowed-tools: Bash(node:*), Read
---

# /al-verify — L1 compile + L2 analyzers

Run the verifier from the repository root:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/al-verify.js" $ARGUMENTS
```

- No arguments: L1+L2 for every AL project, in dependency order (App before Test).
- `--l1`: compile only (faster; same check as the Stop gate).
- `--project <name|folder>`: one project plus the in-repo projects it depends on.
- Exit code: `0` no errors, `1` errors, `3` not-run (no compiler, no symbols, no `app.json`).

The full diagnostics are in `.claude/.aldc-verify/last-report.json`. Read it only when the summary is not enough. Do not paste it whole.

## How to report

Reply in the user's language (the plugin's `language` setting, or the language the user writes in), in at most 8 lines:

1. One line per project: errors, compiler warnings, analyzer warnings.
2. Errors first, each as `file(line,col): CODE: message`.
3. For warnings, only the codes that repeat most. Say which ones are new compared with the code before your change if you know it; if you don't know, don't guess.

## Rules

- Never report "compiles" or "0 errors" without having run this command in this turn. If it returned `not-run`, say **not-run** and why.
- **Invoked by the user** (`/al-verify` is the request itself): report only. Do not edit any file, not even to fix errors; offer the fix in one line and wait.
- **Invoked by you during a task**: errors in the code you changed block. Fix them and run `/al-verify` again before finishing. Pre-existing errors: report them, don't fix them unless the task requires it.
- Analyzer and compiler warnings never block. Only touch warnings on lines you changed in this task.
- Repo-specific known warnings (that never block) belong in the repo's CLAUDE.md, not here.
- The compiler version is pinned per repo in `.claude/aldc-verify.json` (`compiler.alExtension` or `compiler.alTool`, plus `bcMajor`). If the summary says "not pinned" ("sin fijar" in Spanish), mention it once.
