---
name: al-go
description: Ship finished AL work without waiting for a human - verify (compile + analyzers), BCQuality review if installed, commit file by file, push a claude/ branch and open a draft PR. Use when a task's AL changes are complete and you want them delivered for review; the guard hook blocks merges, force pushes and pushes to the default branch.
argument-hint: "[branch-slug] [--no-review]"
allowed-tools: Bash(node:*), Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git branch:*), Bash(git rev-parse:*), Bash(git switch:*), Bash(git add:*), Bash(git commit:*), Bash(git push:*), Bash(gh pr create:*), Bash(gh pr view:*), Read, Grep, Glob, Edit
---

# /al-go - verify -> review -> commit -> push -> draft PR

The AL counterpart of a "go" command. You (or the agent that invoked this) decide and act. **Do not stop to ask the user** unless a step below says to stop. The safety net is mechanical: the aldc-verify guard hook refuses merges, force pushes, pushes to the default branch, mass `git add` and protected paths. If it denies a command, do not work around it: fix your approach or stop and report.

The repo's own `CLAUDE.md` rules take precedence over this skill. Read it first if it exists. Report in the user's language (the plugin's `language` setting, or the language the user writes in). Commit messages and PR titles follow the repo's existing style (`git log --oneline -15`).

## 1. Branch

- Run `git status --short`, `git branch --show-current`, and find the default branch (`git rev-parse --abbrev-ref origin/HEAD`, or `main`).
- On the default branch: `git switch -c claude/<slug>`. The slug is the first argument, or a short kebab-case name for the work.
- If nothing changed and no commits are ahead of the base, say so and stop.

## 2. Verify (blocking)

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/al-verify.js"
```

- Exit `1` (errors): fix the errors in code you changed and run it again, at most 3 rounds. If errors remain, or they are pre-existing, stop without committing and report them.
- Exit `3` (not-run): stop and report. Nothing gets shipped unverified.
- `Status: partial` (`Estado: partial` in Spanish; L2 incomplete): continue, and say so in the PR.

## 3. Version

If `.al` files changed in a non-test project and the repo rules require a version bump on every delivery, bump that project's `app.json` `version` (last part +1), unless it is already higher than on the base branch. Without such a rule, do not bump; mention the current version in the PR. Never bump a Test app.

## 4. Review (skip with `--no-review`)

If a BCQuality review skill is available (`bcquality:al-code-review`, or `aldc:review`), run it on the changed AL files.

- **Blocking findings in your own changes:** fix them, then go back to step 2 (once).
- **Findings in pre-existing code:** list them in the PR. Do not fix them.
- **No review skill:** write "review: not-run (no BCQuality)".

## 5. Commit, file by file

- `git add <path>` for each changed file. Never use `-A`, `.` or `commit -a`; the guard denies them.
- **Automatically exclude:**
  - build output (`*.app` outside `.alpackages`, `.claude/.aldc-verify/`);
  - the paths in `guard.protectedPaths` of `.claude/aldc-verify.json`;
  - documents with real data (`*.xlsx`, `*.pdf`, `*.zip`, `*.csv` that are not test fixtures);
  - anything that looks like a secret.
- **If unsure about a file:** leave it out and list it in the PR as "not included".
- **TDD repos** (test commit before code commit): with test and code changes, make two commits, tests first.
- **Commit message:** the repo's style, plus the attribution lines the environment specifies. No model identifiers.

## 6. Push and draft PR

- `git push -u origin <branch>`. On a GitHub email-privacy rejection, stop and report. Never change the user's identity unasked.
- `gh pr create --draft --base <base>`. The body has:
  - what changed;
  - the verify line per project;
  - the review result;
  - excluded files;
  - what is not-run (tests without a BC v28+ sandbox).
- Never merge and never mark the PR ready: a person reviews it.

## 7. Report

At most 6 lines: branch, commits, verify, review, PR link, and anything not-run or excluded.
