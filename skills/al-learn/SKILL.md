---
name: al-learn
description: After the user corrects how you worked in an AL repo (a convention, a rule, a mistake not to repeat), propose ONE line for the repo's CLAUDE.md and add it only if the user approves. Use right after such a correction, or when the user says "apréndetelo", "que no vuelva a pasar", "add this to CLAUDE.md".
argument-hint: "[the lesson, optional]"
allowed-tools: Read, Grep, Glob
---

# /al-learn - the CLAUDE.md that accumulates

Turn one correction into one durable rule for this repository.

## 1. Find the lesson

Use the argument if one was given. Otherwise, take the user's most recent correction in this conversation. If there is no clear correction, ask what to learn and stop.

## 2. Write ONE line

- Imperative, specific and checkable, at most about 140 characters. Example: `Never use Key as an AL variable name: it is a reserved word (AL0519).`
- Generalize from the incident to the rule, but keep the concrete trigger (object, code, command) that makes it recognizable.
- Same language as the existing `CLAUDE.md`; the user's language if there is none.
- No secrets, no real business data, no personal names.

## 3. Check before proposing

- Read the repo's `CLAUDE.md` (root). If it doesn't exist, propose creating it from the plugin template with `/aldc-verify:init` instead of writing a bare file, and stop.
- If an existing line already says the same thing, say so and stop.
- If an existing line contradicts the new one, show both and propose a replacement instead of an addition.
- Choose the section: one that fits; otherwise `## Learned` (`## Aprendido` in a Spanish `CLAUDE.md`; create it at the end if missing).

## 4. Ask

Show exactly:

```
Proposal for CLAUDE.md (section "<section>"):
+ <the line>
```

Then ask for approval (yes / edit / no). **Do not write anything without an explicit yes.**

## 5. Write

On yes, insert the line with Edit (one bullet, `- ` prefix) in that section and confirm in one line. Do not commit: the user decides when, for example with `/aldc-verify:al-go`.

Keep `CLAUDE.md` under 200 lines. If the addition would pass that, say so and propose which old line to merge or drop.
