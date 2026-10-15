---
name: al-go
description: Ship the current AL work - verify (compile + analyzers), optional BCQuality review, commit file by file, push and open a draft PR. Has side effects, so it only runs when the user invokes it.
argument-hint: "[branch-slug] [--no-review]"
disable-model-invocation: true
allowed-tools: Bash(node:*), Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git branch:*), Bash(git rev-parse:*), Read, Grep, Glob
---

# /al-go - verify -> review -> commit -> push -> draft PR

The AL counterpart of a "go" command. Run every step in order and stop at the first one that fails. Talk to the user in Spanish; commit messages and PR titles follow the repo's existing style (`git log --oneline -15`).

The repo's own `CLAUDE.md` rules take precedence over this skill. Read it first if it exists.

## 1. Where am I

- `git status --short`, `git branch --show-current` and the default branch (`git rev-parse --abbrev-ref origin/HEAD`).
- **On the default branch** (main/master/DEV): create `claude/<slug>`. Use the first argument as the slug, or derive a short kebab-case slug from the work. Never commit to the default branch.
- **Nothing changed** (`git status` clean and no commits ahead of the base): say so and stop.

## 2. Verify (blocking)

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/al-verify.js"
```

- Exit `1` (errors) or `3` (not-run): stop. Report the summary and do not commit.
- `Estado: partial` (L2 incomplete): say so, then continue.
- Exit `0`: keep the per-project summary line for the PR.

## 3. Version (when AL changed)

If any `.al` file under a non-test project changed compared with the base branch (`git diff --name-only origin/<base>...` plus the working tree), check that project's `app.json` `version`. If it is the same as on the base branch and the repo rules say the version goes up on every delivery, **ask** the user before bumping it (usually the last part, +1). Never bump a Test app unless asked.

## 4. Review (skip with `--no-review`)

If a BCQuality review skill is available (`bcquality:al-code-review`, or `aldc:review` from ALDC), run it on the changed AL files. Report blocking findings and ask whether to continue. Without a review skill, say "revisión: not-run (sin BCQuality)" and continue.

## 5. Commit, file by file

- List the changed and untracked files. **Never** use `git add -A`, `git add .` or `git commit -a`.
- Exclude:
  - build output (`*.app` outside `.alpackages`, `.claude/.aldc-verify/`);
  - customer data folders and documents (for example `CustomerDocuments/`, `*.xlsx`/`*.pdf`/`*.zip` that are not test fixtures);
  - anything that looks like a secret.
  When in doubt, ask.
- Show the exact list you will stage and wait for the user's OK. Then `git add <path>` for each file.
- If the repo follows TDD with "test commit before code commit" and both test and code files changed, make two commits: tests first, then code.
- Commit message: the repo's style, plus the attribution lines the environment specifies. No model identifiers.

## 6. Push and draft PR

- `git push -u origin <branch>`. If GitHub rejects it for email privacy, tell the user and stop. Do not rewrite their identity unasked.
- Create a **draft** PR with `gh pr create --draft --base <base>`. The body contains:
  - a short summary of the change;
  - the verify line from step 2 (per project: errors / warnings / analyzers);
  - the review result from step 4;
  - anything that is **not-run** (for example tests, which need a BC v28+ sandbox).
- Never merge. Never mark the PR ready.

## 7. Report

At most 6 lines: branch, commits, verify result, review result, PR link, and what is still not-run.
