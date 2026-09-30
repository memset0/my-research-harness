# OpenSpec workflow routing and lifecycle

Generic OpenSpec workflow rules for this repository, moved out of the root
`AGENTS.md`. `AGENTS.md` requires reading this file before any OpenSpec or Git
operation. Repository-specific requirements (testing, deployment, tasks.md
scope, release, instruction-file convention, concurrency-safe Git workflow,
commit messages) stay in `AGENTS.md` and take precedence over this file where
they are more specific. "The concurrency-safe Git workflow" and "the Git
commit-message rules" below refer to those sections of `AGENTS.md`.

- Use the repository's generated OpenSpec workflows.
- Before implementation, read `openspec/config.yaml`, the relevant canonical specs under `openspec/specs/`, and the applicable active change artifacts.
- Keep OpenSpec artifacts aligned with the implementation and validate completed work before archiving.

### Core workflow routing

- The core workflows are `explore`, `propose`, `update`, `apply`, `sync`, and `archive`. Select them from the user's intent and the current change state.
- Use `explore` for discussion, investigation, and requirement clarification without implementation.
- Use `propose` when development work has no matching active change. Create and validate every planning artifact required before implementation. The propose phase itself MUST NOT edit implementation files.
- Use `update` to revise existing planning artifacts and keep them coherent. It MUST NOT edit implementation files or create missing artifacts.
- Use `apply` to implement a ready change. Follow its dynamic instructions and read every returned context file before editing implementation files.
- Use `sync` to merge delta specs into canonical specs without archiving, or when invoked as part of archive.
- Use `archive` to finalize a completed and validated change. Sync delta specs by default unless the user explicitly requests otherwise.

### Expanded workflow routing

- The additional workflows are `new`, `ff`, `bulk-archive`, and `onboard`. Their availability is not permission to invoke them implicitly.
- Use `new` only when the user explicitly requests a change scaffold without the remaining planning artifacts. Stop after creating the scaffold unless the user explicitly requests another planning action.
- Use `ff` only when the user explicitly requests generation of all remaining planning artifacts for a scaffolded or partial change.
- Use `bulk-archive` only when the user explicitly requests archiving multiple eligible changes together.
- Use `onboard` only when the user explicitly requests interactive OpenSpec onboarding. State first that it performs real repository work, follow every generated pause, and require its ready-to-implement confirmation before editing implementation files.
- Do not substitute agent judgment about complexity, simplicity, parallelism, or educational value for the explicit user intent required by these additional workflows.

### Lifecycle orchestration

#### Transition policy

- Treat `propose`, `apply`, and `archive` as separate workflow phases. Complete the current phase and satisfy its requirements before starting the next one.
- Resolve apply and archive continuation independently. The current user request takes precedence, followed by the latest still-applicable user preference, then repository-specific defaults. Without authorization from those sources, stop for review. A later user instruction replaces an earlier preference.
- An explicit request for proposal-only, no apply, or no archive blocks the corresponding transition regardless of any automatic repository default.
- A standing user preference for automatic apply or archive remains effective across turns until the user revokes or replaces it. Do not require the user to repeat an applicable authorization.
- These rules govern orchestration between generated workflows. They supersede only a generated workflow's requirement for an additional user turn before starting the next phase; they never bypass workflow steps, validation, readiness checks, tests, ambiguity handling, ownership boundaries, or failure handling.

#### Propose phase

- Create and validate every planning artifact required for implementation.
- Do not edit implementation files within the propose phase.
- Start `apply` in the same turn when the user requested implementation or apply, or when automatic apply is enabled.
- Otherwise, present the completed planning artifacts and leave the change ready for review.

#### Apply phase

- Start `apply` only when the target change is unambiguous, all required planning artifacts exist, planning validation succeeds, and the generated apply instructions report a ready state.
- Follow the generated dynamic instructions and read `openspec/config.yaml`, relevant canonical specs, every returned context file, and the applicable active change artifacts before editing implementation files.
- Keep the active change artifacts aligned with implementation. Fold small implementation refinements into the proposal, delta specs, design, and tasks as applicable.
- Pause when implementation requires materially different or additional scope instead of silently narrowing, deferring, or simplifying the specified behavior.
- Mark a task complete only after its full behavior and proportionate verification succeed.
- Before leaving apply, ensure the planning artifacts describe what was actually implemented.
- After apply and all required verification pass, start `archive` when the user requested it or automatic archive is enabled.
- Otherwise, leave the change active, present the implementation and test results for acceptance, and explicitly ask whether it should be archived.

#### Archive phase

- Start automatic archive only after all implementation tasks are complete, required tests pass, the artifacts match the implementation, and OpenSpec validation succeeds.
- An explicitly requested archive must still follow the generated workflow's completion checks, warnings, and required confirmations.
- Sync delta specs into canonical specs by default. Skip sync only when the user explicitly requests archive without syncing.
- If no delta specs exist, report that there was nothing to sync.
- After sync, verify every affected canonical spec before moving the change.
- After archive, verify the archived change and report its final state.
- After every successful archive, automatically commit only the current task's work and push it following the concurrency-safe Git workflow in `AGENTS.md`.
- Present the completed result for user acceptance after archive, commit, and push finish.
- If archive or required spec sync fails, leave recoverable state intact and do not commit or push.

### Development entry gate

- Treat every request to implement, fix, refactor, add or change tests, change configuration, or change behavior documentation as development work.
- Before editing any implementation file, the agent MUST inspect the OpenSpec configuration, canonical specs, and active changes, then MUST select the applicable generated OpenSpec workflow instead of reconstructing it from memory.
- If no active change matches and no explicitly requested `new` or `onboard` entry action applies, the agent MUST use the generated propose workflow. Continue or stop afterward according to the lifecycle orchestration rules above.
- If exactly one active change matches and the user requests implementation, the agent MUST use the generated apply workflow. If several changes could match, list them and obtain the user's selection first.
- Outside an explicitly requested `onboard` workflow after its own ready-to-implement confirmation, the agent MUST NOT edit implementation files while apply is blocked, before apply reports a ready state, or before all required context files have been read.
- Read-only explanation, investigation, status reporting, and OpenSpec tooling installation or repair are not development work. If such work turns into a request to edit project behavior, apply this gate before the first edit.

### Installation and updates

- After every successful OpenSpec installation, reinstallation, repair, or update, create a separate Git commit containing only the repository files that operation modified or created.
- Stage the exact affected paths explicitly. Do not mix application changes, archive changes, or unrelated work into the OpenSpec setup commit.
- Create the commit on the resolved main branch and follow the Git commit-message rules in `AGENTS.md`. Prefer `chore(openspec): install OpenSpec tooling`, `chore(openspec): reinstall OpenSpec tooling`, or `chore(openspec): update OpenSpec tooling`, as applicable.
- Do not create an empty commit when the operation changed no repository files. Do not commit when the installation or update failed.
- Keep this setup commit separate from the automatic archive commit. After the setup commit succeeds, automatically push it following the concurrency-safe Git workflow in `AGENTS.md`. Do not push if setup or commit creation failed.
