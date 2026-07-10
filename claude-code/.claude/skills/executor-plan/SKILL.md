---
name: executor-plan
description: Format constraints for detailed implementation plans that will be executed by a cheap-model executor subagent. Used in the Detailed plan step of the ticket workflow, layered on top of superpowers writing-plans. Language/stack agnostic. Use when writing implementation plans that a cheap-model executor subagent will execute.
---

# Executor Plan Constraints

A constraint layer on top of writing-plans for plans that will be
executed by a cheap-model executor. Write the plan following the
writing-plans methodology first, then apply the constraints below.
**Where the two conflict, this skill wins.** This skill is
language-agnostic — verify/test commands come from the project's
actual toolchain (read from the codebase, never assumed).

## Core principle

Cheap models are good at following, bad at reasoning. Every decision
(design, naming, approach, code) must be settled in the plan. The
executor only applies and verifies — leave it NO choices.

## Mandatory constraints

1. **Length**: each plan file under ~400 lines (~3-4k tokens). Bigger
   ticket → split into `docs/plans/<ticket-id>-phase-1.md`,
   `-phase-2.md`... Each phase file must stand alone (the executor
   runs one file per dispatch, in a clean session, with no knowledge
   of other phases).

2. **Context**: max 10 lines. State only what the problem is and the
   chosen fix direction. No analysis history, no rambling.

3. **Steps**:
   - Ordered by **dependency** — each step independently testable and
     committable; no step depends on a later one.
   - Each step touches at most 1-2 files, with exact paths.
   - Quote the **current state** of the code (only from files actually
     read) before the replacement code, so the executor can locate the
     right spot.
   - The intended code is written out in the plan (full code block or
     diff); the executor only copies and wires it in. Include an
     **exemplar**: a snippet from the repo showing the convention to
     follow (style, naming, error handling).
   - Each step ends with a **verify command + expected output** — a
     runnable command and a machine-checkable expected result, not
     prose (e.g. "exit 0, output contains 'All tests passed'").

4. **Test strategy**:
   - Specify tests by pointing at an **existing test file in the repo**
     (include its path) as the pattern — never let the executor invent
     its own testing approach.
   - Do NOT require test-first (TDD) for purely declarative/UI files
     (UI components, templates, styles, config, layout, pure schema
     migrations...) — write those directly; if such a file already has
     tests, update existing cases rather than adding new ones.
   - Business logic, services, utils: tests required, with exact
     commands per the project toolchain.

5. **Constraints section** (mandatory):
   - NO refactoring, renaming, or "while I'm here" improvements
   - NO edits outside the files listed in the plan
   - **Near-miss files**: list similar/related files that must NOT be
     touched (cheap executors love editing look-alike files)
   - **Escape hatches**: "if X happens (file missing, code changed,
     verify fails twice) → STOP and report the blocker, do not
     improvise"

6. **Out of scope section** (mandatory): list what NOT to do,
   especially cheap-model temptations (fixing tests to make them pass,
   adding abstractions, deleting "dead" code, bumping dependency
   versions).

7. **Final verification** (mandatory): list of commands + concrete
   expected output for the whole plan, using the project's toolchain
   (e.g. `flutter analyze` / `npm run lint && npm test` /
   `cargo clippy && cargo test` / `pytest` / `go vet && go test ./...`).

## Template

````markdown
# Plan: <ticket-id> - <short name>

## Context
<≤10 lines: problem + fix direction>

## Constraints
- NO refactoring/renaming beyond the plan
- NO edits outside the files listed below
- Near-miss (do NOT touch): <similar-looking but unrelated files>
- Escape hatch: <condition> → stop, report blocker

## Steps

### Step 1: <action> — `<file path>`
- Current state (line ~<n>):
  ```<lang>
  <current code excerpt>
  ```
- Replace with:
  ```<lang>
  <pre-written code>
  ```
- Convention exemplar: see `<exemplar file>` — <what to follow>
- Verify: `<command>` → expected: <specific output/exit code>

### Step 2: <test for step 1> — `<test file path>`
- Follow the pattern of `<existing test file>`
- Verify: `<test command>` → expected: <result>

## Final verification
- `<command 1>` → <expected output>
- `<command 2>` → <expected output>

## Out of scope
- <what not to do>
````

## Pre-save checklist

- [ ] Under 400 lines? (split into phases if not)
- [ ] Does the executor have to decide anything itself? (must be NO)
- [ ] Steps in dependency order, each committable on its own?
- [ ] Every step has: current state + pre-written code + exemplar +
      verify with expected output?
- [ ] Tests follow an existing test file's pattern? No TDD forced on
      UI/declarative files?
- [ ] Constraints (with near-miss + escape hatches), Out of scope,
      Final verification all present?
- [ ] Verify commands match the project toolchain? (no language
      assumptions)
