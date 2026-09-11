## Purpose

Provide on-demand Chinese bilingual reading of English document bodies while preserving authoritative sources, document structure, and access boundaries.

## ADDED Requirements

### Requirement: Translation is an explicit non-destructive reading mode

Experiment documents, wiki pages, and Markdown reports SHALL offer owners an explicit Simplified Chinese bilingual reading action. Opening a page SHALL NOT start translation. Original prose SHALL remain visible beside or above its corresponding translation. Returning to original mode SHALL stop pending work and remove translation UI without writing source files, changing timestamps, or changing review state. The action SHALL disclose that selected body prose is sent to Codex using the serving instance's account quota.

#### Scenario: Translate and restore a document
- **WHEN** an owner enables translation and then returns to original mode
- **THEN** translations appear adjacent to their matching original blocks while enabled
- **AND** the original document bytes, timestamps, links, outline anchors, and verification marks remain unchanged

The main button SHALL toggle between original and bilingual modes, including stopping in-progress work. Disclosure, shortcut guidance, and progress labels SHALL be English. Completed translations for the unchanged mounted body SHALL remain available while hidden, so re-enabling them requires no new HTTP request or provider invocation. Source changes and editing SHALL invalidate retained results.

#### Scenario: Repeated button toggle
- **WHEN** an owner clicks the main button after translation finishes and then clicks it again
- **THEN** it hides and restores the existing translations without retranslating the unchanged body
- **AND** Alt+T performs the same action

### Requirement: Keyboard toggle targets one reading body

Alt+T SHALL invoke the same translation/original toggle as the controls for owners. Only the focused or most recently interacted-with visible reading body SHALL handle it, falling back to the first visible body. Hidden dialogs/reading roots and bubbling handlers SHALL not swallow the shortcut. A visible modal SHALL restrict handling to its own reading body, if present; editing-only dialogs, inputs, editors, composition, repeated keystrokes, and additional modifiers SHALL not trigger it. Unavailable translation SHALL not consume quota. The controls SHALL show the shortcut.

#### Scenario: Stop via keyboard
- **WHEN** an owner presses Alt+T while the selected body is translating
- **THEN** its pending work is cancelled and original-only rendering is restored
- **AND** other bodies remain unchanged

### Requirement: Only registered document body prose is eligible

Translation SHALL include authored body headings, paragraphs, list prose, blockquotes, natural-language table cells, and visible captions. Experiment Implementation, Investigation, and Results prose SHALL be taken from their rendered normalized content, not raw YAML or managed pointer lines. Navigation, frontmatter, page chrome, diagnostics, generated outlines, run panels, editors, code blocks, mathematical expressions, identifiers, numeric metrics, raw component payloads, controls, and iframe interiors SHALL be excluded. Unsupported embedded content SHALL remain functional and visibly untranslated. Already translated output SHALL never become input.

#### Scenario: Mixed experiment body
- **WHEN** a document contains narrative prose, structured step descriptions, result numbers, an inline formula, and an expanded run
- **THEN** only the narrative and rendered structured prose are translated
- **AND** formulas, result numbers, identifiers, and the run panel remain unchanged

#### Scenario: Wiki and report embedded content
- **WHEN** a wiki or report body contains a figure caption and an interactive HTML embed
- **THEN** the visible caption outside the embed is eligible
- **AND** the embed's DOM, scripts, data payloads, and navigation labels are not extracted

### Requirement: Segmentation preserves inline semantics and safe rendering

The extractor SHALL group adjacent inline prose within each logical block, avoid nested duplicate extraction, and preserve document order. Inline code, formulas, URLs, artifact identities, and non-prose inline objects SHALL be protected. Translations SHALL retain valid emphasis and original link destinations using only locally trusted structure. Model output SHALL NOT create executable HTML, new link targets, handlers, or embeds. Invalid protected-token mappings SHALL fail the affected segment rather than corrupt the document.

#### Scenario: Formatted sentence with a link and code
- **WHEN** one paragraph includes emphasis, a link label, and inline code
- **THEN** it is translated as a coherent segment with the original code and link destination preserved
- **AND** injected markup or missing protected tokens are rejected

### Requirement: Batches are bounded and exactly correlated

The initial body manifest SHALL include all validated cached results for its exact current revision without invoking Codex. The frontend SHALL render those results before inference completes and submit remaining bounded packs concurrently rather than waiting for the previous pack. Each completed pack SHALL update independently, including when a sibling pack fails. Source-revision failure SHALL clear obsolete results and cancel sibling requests. Cache reads SHALL use bounded bulk database operations, not one transaction per segment.

#### Scenario: Mixed cached and uncached body
- **WHEN** a body has existing cache hits and multiple uncached packs
- **THEN** all validated hits are returned together with the manifest and displayed immediately
- **AND** the uncached packs are submitted together and queued behind at most two translation-owned Codex invocations
- **AND** a completed pack renders without waiting for other packs

#### Scenario: Fully cached body
- **WHEN** all eligible body segments have valid cache entries
- **THEN** one manifest response supplies all translations and the frontend sends no translation POST
- **AND** a pending Codex readiness probe does not prevent the owner from requesting cached results; the server still enforces feature enablement and owner authorization

Eligible segments SHALL be packed by maximum item count, serialized input size, and a bounded flush delay rather than issuing one model invocation per paragraph. Oversized individual segments SHALL be split at safe text boundaries without breaking protected objects or rejected with a visible segment error. Every result SHALL be correlated by stable segment ID; unknown or duplicate IDs SHALL never overwrite another segment. Missing, empty, or malformed results SHALL become retryable failures. Successful validated segments SHALL remain usable after partial failure.

#### Scenario: Out-of-order and incomplete output
- **WHEN** a batch returns valid results in a different order and omits one segment
- **THEN** valid results attach to the correct IDs and only the omitted segment is marked failed
- **AND** no task waits indefinitely for a missing result

### Requirement: Translation work is bounded, cancellable, and revision-aware

The service SHALL bound active invocations, queued work, input/output sizes, execution duration, and cache memory. The UI SHALL expose progress, cancellation, and retry of failed segments. Switching document, editing, source refresh, or unmount SHALL cancel obsolete subscriptions and ignore late responses. Cache and in-flight deduplication SHALL include exact Host/project/document identity, body revision, segment content, target language, model, and translation format version. Validated results SHALL persist in a private local SQLite database beside the serving configuration, survive process restarts, and be bounded by age, entry count and stored bytes. Authorization and source validation SHALL precede cache access. No credentials or original prompts SHALL be persisted. Cached output SHALL be revalidated before rendering; storage failures SHALL be redacted and not silently trigger uncached paid retranslations.

#### Scenario: Restart and reuse a translation
- **WHEN** an authorized unchanged body is translated again after a process restart
- **THEN** matching validated SQLite results are returned without invoking Codex
- **AND** changed revisions, malformed or expired entries are not reused

#### Scenario: Source changes during translation
- **WHEN** a live update changes a body while its translation is running
- **THEN** the previous revision's results are not attached to the new body
- **AND** the owner can explicitly translate the refreshed body

#### Scenario: Repeated request and overload
- **WHEN** two owner views request an identical segment and the queue later reaches capacity
- **THEN** identical work is coalesced without duplicate model calls
- **AND** excess new work receives an explicit retryable overload error

### Requirement: Translation APIs are owner-only and scope-exact

Status, translation, retry, and cancellation endpoints SHALL require owner authentication with handler-level checks. Viewer and anonymous requests SHALL be rejected before cache access or provider invocation. Each translation SHALL resolve an exact configured project and document identity; arbitrary paths, hosts, provider URLs, prompts, and model overrides SHALL not be accepted. Any document filesystem access SHALL use the existing project-root containment checks. Client-supplied segments SHALL be bounded and verified against the selected current body revision before model invocation.

The owner-only body-manifest read SHALL validate the requested revision and return only matching segment identities, hashes, and protected text. Trusted reconstruction templates SHALL remain local to source parsing. Translation responses SHALL recheck the source revision after inference and SHALL not be HTTP-cached.

#### Scenario: Viewer attempts to spend owner quota
- **WHEN** a viewer directly calls the translation endpoint for an otherwise readable page
- **THEN** the request is denied under the existing owner-only route convention
- **AND** no cache data or Codex invocation is produced

#### Scenario: Equal IDs and stale source
- **WHEN** the same document ID exists in two projects or a client submits an outdated body revision
- **THEN** the service uses only the explicitly resolved project
- **AND** a stale or mismatched body is rejected without provider invocation
