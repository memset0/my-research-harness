## Context

`InboxShell` owns both Report and Digest list/detail layouts. Its desktop rail
is currently unconditional, while `RailList` emits the same divider-row links
for both kinds. The selected item's body scroll container has no background
class, so it inherits the application `background` token. The existing tmux
management list already establishes a compact selectable-card language using
semantic `card`, `accent`, `primary`, and `ring` tokens.

`FrontmatterPanel` is also shared by Reports and Digests and currently formats
values without considering their keys. `js-yaml` can represent an unquoted ISO
timestamp as a `Date`, while a quoted timestamp remains a string. The existing
`TimestampLocal` component already handles client-local formatting without a
timezone-sensitive hydration mismatch.

The implementation must retain the mobile Report-list Sheet, optimistic editor
flow, nested vertical/horizontal overflow fixes, and Report HTML embed behavior.

## Goals / Non-Goals

**Goals:**

- Keep Report-specific presentation decisions explicit inside the shared inbox
  without changing Digest behavior.
- Make the desktop picker toggle accessible in both the open and closed states.
- Reuse the tmux list's visual rhythm while preserving native Report links and
  shadcn theme semantics.
- Reuse the established local timestamp presentation for canonical Report time
  fields without changing stored frontmatter.

**Non-Goals:**

- Redesigning Digest navigation or making its rail collapsible.
- Changing Report discovery, ordering, routes, APIs, stored files, or editor
  behavior.
- Persisting the rail preference across a page remount in this iteration.
- Reusing tmux-only badges, actions, state colors, or session-card data layout.
- Guessing that arbitrary frontmatter keys or timestamp-looking strings are
  dates.

## Decisions

### D1. Keep one inbox implementation with explicit Report-only branches

`InboxShell` will continue to serve both artifact families. It will own a
Report rail-visibility state that starts open; the desktop Report `<aside>` is
conditionally included based on that state, while the Digest `<aside>` follows
its existing unconditional path. The mobile Sheet remains available regardless
of desktop state and does not inherit the desktop visibility flag.

Splitting Report and Digest into separate shells would duplicate querying,
editing, routing, and responsive behavior for a presentation-only difference.
Making both inbox kinds collapsible would broaden the requested change and
alter Digest behavior without a user need.

### D2. Put the toggle where it remains reachable in each state

When the Report rail is open, its header will expose an icon-sized shadcn
Button labelled `Hide reports`. When closed, the selected-item toolbar or the
empty-pane toolbar will expose the corresponding `Show reports` Button. The
control uses a familiar panel icon plus an accessible name/tooltip; visibility
is not communicated by icon direction alone.

A handle that disappears with the rail cannot restore it. A permanently
floating control over the document was considered, but integrating the action
with existing toolbar chrome reduces overlap risk for Report Markdown and HTML
embeds.

### D3. Apply `bg-card` to the Report body scroll surface

The Report-specific background belongs on the flex child that scrolls the
rendered frontmatter and Markdown, not only on the inner padded content block.
That makes short Reports white through the bottom of the available pane and
keeps the existing overflow boundary intact. `bg-card` gives the requested pure
white in the current light theme and the appropriate card color in dark mode;
hard-coded `bg-white` would break dark-theme contrast.

The sticky metadata/edit toolbar remains separate chrome. Loading, error,
not-found, and empty states are not document surfaces and keep their current
treatment.

### D4. Use native links styled with shadcn semantic tokens for Report cards

Report entries will retain one `<Link>` as the complete interactive target and
receive the compact tmux-card treatment: rounded border, `bg-card`, inset
padding, a small inter-card gap, accent hover, visible `focus-visible` ring, and
primary active border. Text uses the existing Report ID/title/slug data with
truncation and muted secondary metadata.

Using nested buttons or a `role="button"` wrapper would weaken link semantics
and browser navigation behavior. Importing tmux's `SessionCard` would couple
unrelated data and actions. The shared visual vocabulary is therefore reused
through shadcn tokens and layout conventions rather than component coupling or
copied tmux metadata.

### D5. Make frontmatter time formatting explicit by artifact kind and key

`RenderedItem` will identify the artifact kind when it invokes
`FrontmatterPanel`. Only Report rows named exactly `created_at` or `updated_at`
will opt into timestamp presentation. The row will normalize a `Date` with
`toISOString()` or pass a string to the existing `TimestampLocal` long variant;
invalid strings remain on the scalar path, and null/empty handling continues to
run first.

Making `FrontmatterPanel` infer every date-looking value would unexpectedly
reformat selectors, IDs, or custom fields and would also change Digests. Parsing
dates earlier in `splitFrontmatter` was considered, but that utility should stay
lossless with respect to the YAML loader's existing type-aware behavior. The
key-aware render branch is narrow, testable, and does not mutate the editor
buffer or on-disk frontmatter.

## Risks / Trade-offs

- [Risk] Report-only conditions inside a shared shell can accidentally affect
  Digests. → Keep kind checks at the rail, body-surface, and list-entry
  boundaries and add paired Report/Digest regression tests.
- [Risk] Hiding the rail can leave no route back to the list. → Test the
  closed state with both a selected Report and the Reports empty pane, and
  require a reachable Show reports action.
- [Risk] A card treatment can consume more vertical space than divider rows.
  → Follow the tmux list's compact padding and gap rather than the default
  large content-card spacing; retain rail scrolling.
- [Trade-off] Visibility resets to shown when the inbox remounts. This keeps the
  first iteration stateless and avoids introducing another persisted preference;
  persistence can be specified later if repeated use shows it is valuable.
- [Risk] Locale-sensitive date text is unstable during server rendering. →
  Reuse `TimestampLocal`'s raw-first, client-upgrade behavior and assert the
  hydrated result in component tests.

## Migration Plan

No data or configuration migration is required. Rollback restores the current
unconditional rail, row links, and inherited Report body background without
affecting Report files or APIs.
