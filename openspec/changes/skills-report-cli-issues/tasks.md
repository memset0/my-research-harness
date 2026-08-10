## 1. Shared protocol

- [x] 1.1 Add a concise CLI-issue reporting section to the installed shared preflight contract.
- [x] 1.2 Cover suspected-problem classification, deferred versus blocked handoff, required evidence, workaround/reproducibility, and secret redaction.

## 2. All bundled skills

- [x] 2.1 Make each name in `SKILL_NAMES` explicitly follow the shared protocol whenever it invokes or observes memon CLI behavior.
- [x] 2.2 Keep every SKILL.md under 500 lines and leave frontmatter triggering semantics unchanged.

## 3. Verification and delivery

- [x] 3.1 Validate all skill frontmatter, names, descriptions, references, and line counts.
- [x] 3.2 Run skills typecheck/build and CLI install-skills tests.
- [x] 3.3 Strictly validate this OpenSpec change.
- [x] 3.4 Commit and push the change, then install the exact pushed skill version into VSQA's Claude, Codex, and OpenCode skill targets.
