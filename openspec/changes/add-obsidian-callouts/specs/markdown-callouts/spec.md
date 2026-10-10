## Purpose

Present supporting and deprecated Markdown content as readable callouts with optional disclosure, consistently across document surfaces.

## ADDED Requirements

### Requirement: Obsidian callout presentation

The shared Markdown renderer SHALL recognize a blockquote starting with `[!type]` case-insensitively, support Obsidian built-in types and aliases, and use note styling for unknown types. An optional custom title SHALL retain inline Markdown; absent titles SHALL use the type identifier in title case. The custom `DEPRECATED` type SHALL have an explicit Deprecated label even with a custom title and distinct muted presentation. Ordinary quotations, escaped markers and code examples SHALL remain ordinary Markdown. Callout bodies SHALL retain supported Markdown rendering including lists, tables, code, math, links, and nested callouts.

#### Scenario: Custom title and nested content
- **WHEN** a note callout contains a Markdown title and a nested warning callout
- **THEN** both render as distinct callouts and formatting and links remain usable

#### Scenario: Deprecated content
- **WHEN** a document contains `> [!DEPRECATED] Old result`
- **THEN** the callout visibly identifies deprecated content and displays its title and body

#### Scenario: Unknown identifier
- **WHEN** a document contains `> [!custom] Title`
- **THEN** a note-styled callout renders with that title

### Requirement: Callout disclosure

An immediately following `-` SHALL make a callout initially collapsed, `+` SHALL make it initially expanded and foldable, and no suffix SHALL leave it non-foldable. The title SHALL remain visible while collapsed. Disclosure SHALL support keyboard operation and visible focus. Folding SHALL hide only the quoted body, never subsequent unquoted document content. Recommended historical-content syntax SHALL be `> [!DEPRECATED]-`.

#### Scenario: Collapsed deprecated material
- **WHEN** a reader opens a document with `> [!DEPRECATED]-` and quoted historical content
- **THEN** the title is visible and historical content is initially hidden
- **AND** activating the disclosure reveals the body without navigation

#### Scenario: Expanded and static variants
- **WHEN** the document includes `> [!tip]+` and `> [!tip]`
- **THEN** the first is initially expanded and foldable, and the second has no disclosure control

### Requirement: Existing document features remain compatible

Callouts SHALL retain existing artifact navigation, resource URLs, component fences, translation and review-source highlighting. Callout syntax SHALL NOT be translated as prose; client and server translation segments SHALL agree.

#### Scenario: Translated callout
- **WHEN** translation is enabled for a titled callout
- **THEN** its prose can be translated without showing the marker in translated text or changing disclosure behavior
