## ADDED Requirements

### Requirement: Frontmatter property panel above rendered body

When the currently-selected report or digest content begins with a YAML frontmatter block (a `---\n` opening fence followed by a `\n---` closing fence at the start of the file), the right pane SHALL split the content into (a) frontmatter and (b) body, and SHALL render the frontmatter as a Notion-style property panel above the rendered markdown body. The literal `---` fences SHALL NOT appear in the rendered output, and the keys/values inside the frontmatter SHALL NOT be passed to the markdown renderer.

The property panel SHALL render as a 2-column key/value grid:
- The label cell SHALL display the YAML key (lowercase, monospace, muted color) with stable left-aligned width across rows.
- The value cell SHALL display the parsed value with type-aware formatting: arrays as inline badge chips (one badge per element), strings/numbers/booleans as plain monospace text, and `null`/empty values as a dim em-dash placeholder.

When the file has NO leading frontmatter block, the panel SHALL be omitted and the body SHALL render as today (without spurious `---` artifacts, since none are present in the source).

When the leading `---\n…\n---` block fails to parse as YAML, the renderer SHALL fall back to passing the entire original content (including fences) to the markdown renderer; no panel is shown.

#### Scenario: Report with frontmatter renders panel and clean body
- **GIVEN** a report whose content starts with `---\nhypothesis: H0001\nstatus: CONFIRMED\nexperiments: [foo-260503-082800, bar-260504-091500]\n---\n# Findings\n…`
- **WHEN** the user selects that report
- **THEN** the right pane renders a property panel with rows `hypothesis: H0001`, `status: CONFIRMED`, `experiments: <two badges>`, followed below by the rendered markdown body starting at `# Findings`
- **AND** no `---` characters or raw frontmatter text are visible in the rendered surface

#### Scenario: Digest without frontmatter renders body only
- **GIVEN** a digest whose content begins directly with `# 2026-05-03`
- **WHEN** the user selects that digest
- **THEN** the right pane renders only the markdown body, with no property panel above it

#### Scenario: Malformed frontmatter falls back gracefully
- **GIVEN** a report whose content starts with `---\nbroken: [unbalanced\n---\nbody…`
- **WHEN** the user selects that report
- **THEN** the right pane shows no panel and renders the full original content via the markdown renderer (the user can still read the body and open the editor to fix the frontmatter)

#### Scenario: Editor still operates on the full file
- **WHEN** the user clicks Edit on a report with frontmatter
- **THEN** the Monaco buffer is initialised with the complete on-disk content INCLUDING the `---` fences and frontmatter keys (the panel is a render-side concern, not a storage transformation)

### Requirement: Inline code in inbox markdown is a chip, not styled prose

The shared markdown renderer used by the inbox panes SHALL render inline `<code>` elements as a visually distinct chip:

1. NO literal backtick characters around the element. When the source contains `` `foo` ``, the rendered output SHALL display only `foo` in the monospace face, with no surrounding `` ` `` characters injected by the typography styles.
2. Chip presentation: muted background fill, rounded corners, slight horizontal padding, and a font-size and weight that does NOT exceed the surrounding body text. Concretely the styling derives from the semantic `--muted` and `--foreground` tokens; values are at the component's discretion.

The chip styling SHALL apply ONLY to inline `<code>`. Code rendered inside fenced blocks (`<pre><code>…</code></pre>`) SHALL keep its `<pre>`-level appearance — transparent inner `<code>` background, zero inner padding, no rounded corners on the inner `<code>`, font-size/color inherited from the `<pre>`. Block code SHALL NOT receive the chip background, padding, or rounded corners.

#### Scenario: Inline code in a report body
- **GIVEN** a report body containing the text `` Run `memon scan` to refresh. ``
- **WHEN** the right pane renders the body
- **THEN** the word `memon scan` appears in the monospace face with NO backtick characters before or after it
- **AND** the `<code>` element has a muted background fill and rounded corners (chip presentation)

#### Scenario: Inline code in the empty-state copy
- **WHEN** the inbox empty-state renders `memon-write-report` from the empty-state markdown copy
- **THEN** `memon-write-report` appears in the monospace face with NO backtick characters around it
- **AND** the rendered chip is visually distinct from the surrounding body text via background fill

#### Scenario: Fenced code block keeps pre-level styling
- **GIVEN** a markdown body containing a fenced block with three or more lines of code
- **WHEN** the right pane renders the body
- **THEN** the inner `<code>` element inside the `<pre>` has a transparent background, zero padding, and no border-radius — the visible block styling comes from the surrounding `<pre>`
- **AND** the chip's muted background does NOT appear on either the `<code>` or the `<pre>`
