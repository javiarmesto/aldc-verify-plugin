---
name: init
description: Apply the aldc-verify layer to an AL repo without overwriting anything - .claude/aldc-verify.json (BC version + pinned compiler), .claude/settings.json, CLAUDE.md, .gitignore entry and a GitHub Actions compile workflow. Only runs when the user invokes it.
argument-hint: "[--bc <major>] [--al-extension <ver>] [--al-tool <ver>] [--no-ci] [--no-claude-md]"
disable-model-invocation: true
allowed-tools: Bash(node:*), Bash(git status:*), Bash(git branch:*), Read
---

# /aldc-verify:init

1. **Dry run first:**

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/init.js" --dry-run $ARGUMENTS
   ```

   Show the user the detected values (BC version, projects, compiler pin, plans folder, default branch) and the list of `would-*` / `skipped` lines, in the user's language.

2. **Confirm the pin.** The compiler version is pinned per repo, according to the BC version the extension targets. If the detected `alExtension` or `alTool` might not match that BC version, ask before applying, and rerun with `--bc`, `--al-extension` or `--al-tool`.

3. **Apply only after the user says yes** (same arguments, without `--dry-run`).

4. **Check:** run `/aldc-verify:al-verify --l1` and report the result. If it is not-run or red, say so: the layer is in place, but the repo does not compile yet.

5. **Next steps**, in one line each:
   - The new files are not committed. Use `/aldc-verify:al-go` or commit them file by file. `.claude/` may be in the user's local `.git/info/exclude`; if so, they need `git add -f`.
   - For cloud sessions, add the plugin install to the environment's setup script (see the plugin README).

Never overwrite an existing file. `init.js` only creates missing files, adds missing keys to `settings.json`, and appends the `.gitignore` line.
