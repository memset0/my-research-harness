# Shared memon CLI protocols

## FS convention preflight

Every memon skill that reads or writes spec files (Experiment bundles, Run
READMEs, `docs/hypotheses.md`, `docs/journal.md`, anything under
`docs/digests/`, `docs/reports/`, or `docs/wiki/`) checks the project root's
on-disk schema version before doing any work. The check is a single CLI call;
the agent branches on its result to either proceed, stop with a
recommendation, or surface a fatal mismatch.

This doc is the canonical source for the protocol. Project-aware skills point
here instead of duplicating the branch table. `memon-migrate-fs` is exempt
because it resolves version mismatch.

## How

Run, as the first executable step in the skill workflow:

```sh
memon --project-root . --format json fs-version check
```

`memon-wiki` may operate on an sshfs-mounted project root; it runs this same
check through the channel its mode detection selected (`ssh <user@host> 'cd
<remote root> && memon --project-root . --format json fs-version check'`) and
branches on the identical status values.

Branch on the `status` field:

- `match` → proceed with the rest of the skill.
- `behind` → STOP. Tell the user: "Project FS convention is at v<current>;
  current memon expects v<available>. Please run the `memon-migrate-fs`
  skill to upgrade before continuing." Do NOT read or write any spec file
  (`README.md`, `implementation.yaml`, `investigation.yaml`, `results.yaml`,
  `docs/hypotheses.md`, `docs/journal.md`, `docs/digests/*`, `docs/reports/*`,
  `docs/wiki/*`).
- `uninitialised` → STOP. Tell the user: "This project root has not had
  memon installed yet. Run `memon --project-root . install-skills` first."
  Do NOT read or write any spec file.
- `ahead` → the CLI already exited 11 (`MEMON_TOO_OLD`). Forward the
  error: "Project FS convention is at v<current>; this memon supports up
  to v<available>. Upgrade memon to a release that supports v<current> or
  later." Do NOT proceed.

## Migration runtime exemption

`memon-migrate-fs` is exempt from this preflight. It IS the migration
runtime, and reads `<projectRoot>/.memon/version.json` directly as
part of its own state-determination step. If `memon-migrate-fs` ran
the preflight first, an `uninitialised` or `behind` project would
short-circuit the migration before it could fix the gap.

## Read compatibility is not write compatibility

The web app and document parser intentionally render legacy/unsupported
sections so users can review old projects. That tolerant UI behavior does not
authorize an ordinary skill to operate on a `behind` project. Only the migration
skill may transform old content, and review-required migrations do so in local
staging before touching production files.

## CLI issue handoff

Every bundled skill uses this protocol whenever it invokes the `memon` CLI.
An Agent must not hide a suspected CLI defect merely because it found a
workaround or ultimately completed the user's task.

Treat any of the following as a suspected CLI issue:

- an unexpected non-zero exit, uncaught exception, or crash;
- rejection of an invocation that is valid under the current CLI contract;
- malformed output, including invalid JSON or a response that violates the
  documented output shape;
- inconsistent results from equivalent calls or results that contradict the
  command's documented behavior;
- a workaround required specifically because the CLI did not behave as
  documented.

First preserve safety and make reasonable progress on the user's requested
task. Use a safe workaround when available, without weakening validation or
performing an unapproved destructive action. Capture enough evidence for a
minimal reproduction, but do not turn a completed task into an open-ended CLI
debugging project unless the user asks.

After the requested task is resolved, include a **CLI issue** entry in the final
handoff. If the issue prevents completion, include the same entry in the
blocked handoff instead. Report:

- the command or minimal reproduction, with credentials and sensitive values
  redacted;
- observed behavior versus expected behavior, including the exit code and a
  short sanitized output excerpt when useful;
- impact on the requested task and the workaround, if any;
- reproducibility (`always`, `intermittent`, `observed once`, or `not retested`)
  and relevant CLI/environment version context when known.

Do not label an expected validation or domain-state failure as a CLI bug. For
example, a documented lint rejection of an invalid bundle, an expected
FS-version mismatch, a missing requested record, or an unmet command
precondition is ordinary task state. Report it normally when relevant. When the
contract is ambiguous, say **suspected CLI issue** and explain the uncertainty
instead of either suppressing it or asserting a confirmed bug.
