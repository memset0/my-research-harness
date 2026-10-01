## ADDED Requirements

### Requirement: One frontmatter delimiting rule for hand-parsed documents

Every Markdown document memon splits or patches without a full Markdown
parser (Run README frontmatter patches and deprecation flags, wiki pages,
code-review documents, the journal, and filesystem migrations) SHALL locate
its YAML frontmatter with one rule: an optional leading byte-order mark, an
opening `---` line (trailing spaces or tabs allowed), and the first following
line consisting of `---` or `...` (trailing spaces or tabs allowed) as the
terminator, with LF or CRLF line endings. An empty block SHALL be an empty
mapping. A document without an opening line SHALL be reported as having no
frontmatter, and a document with an opening line but no terminator SHALL be
reported as unterminated. The body SHALL be returned byte-for-byte after the
terminator line. The YAML parser used at each call site is unchanged.

#### Scenario: BOM and CRLF are tolerated everywhere
- **GIVEN** a wiki page that starts with a byte-order mark and uses CRLF
- **WHEN** the page is parsed
- **THEN** its frontmatter is read and its body is returned unchanged

#### Scenario: Empty frontmatter is an empty mapping
- **GIVEN** a code-review document starting with `---\n---\n`
- **WHEN** it is split
- **THEN** its frontmatter is an empty mapping and its body is everything
  after the second line

#### Scenario: Missing and unterminated blocks are distinct
- **GIVEN** one document with no opening `---` and one with an opening line
  but no terminator
- **WHEN** both are split
- **THEN** the first reports no frontmatter and the second reports an
  unterminated block
