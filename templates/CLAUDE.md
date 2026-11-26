# {{REPO_NAME}}

Business Central AL extension for **BC {{BC_MAJOR}}**. Projects: {{PROJECTS}}.

## Non-negotiable rules

- **Branches:** work on `claude/<topic>` from the default branch, push and open a **draft** PR. Never merge without explicit approval from the owner.
- **TDD:** the test commit goes before the code commit. A red test compiles: RED means "the test compiles and describes the behaviour".
- **Git:** never `git add .`, `git add -A` or `git commit -a`. Add files one by one.
- **Real data:** files, exports and documents with real data never go into git.
- **Version:** bump the app's `app.json` `version` on every delivery. The test app does not go to production.
- **Symbols:** compile against the BC {{BC_MAJOR}} symbols in `.alpackages`. Do not replace them with another major version.
- **Language:** code, technical names and commits in English (or the style the repo already uses).
- **Honesty:** if you did not compile or run something, say so ("not-run"). Never assume a result.

## Compile and verify

- `/aldc-verify:al-verify` compiles (L1) and runs the analyzers (L2); `--l1` only compiles.
- When you finish, the Stop hook compiles if you changed AL and does not let you stop with errors.
- `/aldc-verify:al-go` verifies, reviews, commits, pushes and opens the draft PR. You or Claude can run it; it never merges.
- Compiler pinned in `.claude/aldc-verify.json`.
- Tests: `al runtests` needs a BC v28 or later sandbox. Without one, tests compile but do not run (not-run).

## Known warnings (never block)

- (add them with `/aldc-verify:al-learn`)

## Where things are

- Plans and specs: `{{PLANS_ROOT}}`
- Local verification state: `.claude/.aldc-verify/` (ignored by git)

## Learned
