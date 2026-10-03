# Shared Wiki page rules

Kind-specific guidance is generated in [page-kinds.md](page-kinds.md).

A page has exactly one kind. Use `memon wiki move <page> <kind>` to reclassify
explicitly without changing its ID; supply a compatible status when needed.

## Shared frontmatter

| key | required | owner | notes |
|---|---|---|---|
| `id` | yes | CLI | `W<NNNN>`, unique, equals the filename prefix |
| `kind` | yes | CLI | equals the enclosing directory name |
| `title` | yes | author | display title; also the H1 |
| `description` | in practice | author | 1–3 plain-text sentences; shown in every listing |
| `status` | per kind | author | see each kind below; never auto-transitions |
| `date` | per registry | author | `YYYY-MM-DD` |
| `tags` | no | author | string list |
| `sources` | per registry | author | evidence identifiers, see below |
| `legacy_id` | no | `migrate-report` | `R<NNNN>` of the migrated Report |
| `entry` | bundle only | author | relative HTML document rendered as the primary body |
| `deprecated` | no | `wiki deprecate` | `{ at, reason, superseded_by? }` |
| `created_at`, `updated_at` | yes | CLI | ISO8601 with offset |

Unknown keys are preserved verbatim on every write; do not strip a key you do
not recognise.

**Source forms** accepted in `sources`: `E<NNNN>` or `E<NNNN>-slug`,
`E<NNNN>/V<NNNN>` (a Variant declared in that Experiment's `experiment.json`),
`H<NNNN>`, `W<NNNN>`, and a run directory base name
(`zero-snr-eval-260502-110000`). The Variant form is the preferred citation
for a `finding` — it addresses the exact Results row. CLI operations preserve
these references and validate their syntax without opening their targets.
Target existence and `WIKI_SOURCE_UNRESOLVED` checks belong to the Web view.

**Staleness** is derived in Web, not authored: a page is `stale` when any cited
artifact changed after the page's `updated_at`. Inspect source freshness in Web;
the CLI does not resolve targets or offer a source-staleness scan. Re-read the
source and either update the page or explain why it still holds.


## Unknown kinds

Pages in unknown kind directories remain readable and listable with
`WIKI_UNKNOWN_KIND`. Report the issue and propose an explicit move rather than
deleting pages. Registry edits never change page identity, content or human
review marks. No registry update authorizes any migration.
