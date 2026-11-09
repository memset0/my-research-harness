# Verification

## Scope

Implement the agreed discussion workflow: DRAFT/OPEN/CLOSED lifecycle, free-form
question categories, four answer types, append-only feedback and acknowledgements,
CLI authoring/readback, browser close/reopen, semantic revision checks and
localStorage-based fetched-change animation. Existing research formats remain
readable; no operator Project was migrated. The change remains active.

## Change-relevant testlist

- Core: discussion model, guarded append, configuration, catalogs and workflow;
  existing project catalogs, release metadata and FS version tracking. 52 cases
  passed across these files, including the added symlink, malformed-history and
  permission-preservation regressions.
- Backend: discussion routes, original-section recovery from Git, and existing
  project catalogs: 11 cases passed, including nested Git Project roots. A regression checks that a conditional GET
  sees feedback appended after its original response instead of returning an
  unchanged validator with no recorded dependencies.
- CLI: command surface, discussion commands and refresh: 32 cases passed.
- File protocol: append validation and existing protocol contracts: 25 cases passed.
- File Agent: targeted Discussion, Scoped, ConcurrentReplay and TLSGrants Go tests
  passed locally, including append replay, competing sizes, read-grant refusal,
  read-edit admission, bad payloads and symlink refusal.
- Web: discussion forms and view baseline; query keys, Project routes, AppBar,
  sidebar and tab badges; host-qualified permission isolation, API inventory,
  auth classification, document assets and server layering: 162 cases passed
  across the selected files. The viewport/rendered checks below supplement RTL.

The full unit suite was not run; no full-suite or archive gate is claimed.
Root `pnpm typecheck` and touched-file Biome checks passed before committing. Biome
retains two pre-existing NProgress !important warnings in globals.css.

## Rendered and integration checks

A neutral local Project was served from an inactive production build, independent
of the existing production instance. Screenshots and local configuration pointers
are recorded only in the ignored machine notebook.

- Real Chrome loaded four question types and the actual CSS/JS, with no page
  exceptions or failing application requests. The existing missing favicon 404
  was observed separately.
- Desktop and an emulated 390px viewport rendered correctly, without horizontal
  page overflow. Relative SVG and datatable content rendered through document
  asset context. Loaded semantic theme tokens contained oklch values.
- A browser answer appeared in CLI pending; CLI resolve acknowledged captured
  feedback and returned pending to zero. Agent replies and decision history
  remained visible.
- In production mode, fetched feedback highlighted the affected card, updated
  localStorage and preserved text being entered into another question.
- Browser close hid answer controls while retaining four questions; reopen
  restored the appropriate controls. Unanswered questions were preserved.
- Editing a question description produced REVISED and a working unified diff
  dialog with an honestly labeled historical fallback. Git recovery is also
  covered by the dedicated backend test using a truncated response fallback.
- A temporary whole-Project share admitted published discussion reads, refused
  viewer writes, excluded DRAFT details and existing draft assets, and was then
  revoked.
- An isolated marker-only v11-to-v12 guide rehearsal preserved declaration and
  research-document hashes, installed_at and an extension marker field. Catalog
  verification and marker rollback succeeded. It touched no operator Project.

## Release boundary

The requested initial release is 12.0.0, with the reviewed additive FS12 exception
and consecutive migration guide. Implementation and release commits remain
separate. Final release metadata validation and central activation are recorded
at release time; this document does not claim an unexecuted production cutover.
