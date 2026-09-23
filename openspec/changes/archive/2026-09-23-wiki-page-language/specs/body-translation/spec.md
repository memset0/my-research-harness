## MODIFIED Requirements

### Requirement: Translation is an explicit non-destructive reading mode

Experiment documents, wiki pages, and Markdown reports SHALL offer owners an explicit bilingual reading action. Opening a page SHALL NOT start translation. Original prose SHALL remain visible beside or above its corresponding translation. Returning to original mode SHALL stop pending work and remove translation UI without writing source files, changing timestamps, or changing review state. The action SHALL disclose that selected body prose is sent to Codex using the serving instance's account quota. The direction SHALL follow the document language: a wiki page declared `language: zh` SHALL offer an English bilingual reading action ("Translate to English") instead, while English wiki pages, experiment documents and reports keep the Simplified Chinese action. Requests SHALL name the target language (`zh-CN` or `en`), and one provider invocation SHALL never mix targets.

#### Scenario: Translate and restore a document
- **WHEN** an owner enables translation and then returns to original mode
- **THEN** translations appear adjacent to their matching original blocks while enabled
- **AND** the original document bytes, timestamps, links, outline anchors, and verification marks remain unchanged

The main button SHALL toggle between original and bilingual modes, including stopping in-progress work. Disclosure, shortcut guidance, and progress labels SHALL be English. Completed translations for the unchanged mounted body SHALL remain available while hidden, so re-enabling them requires no new HTTP request or provider invocation. Source changes and editing SHALL invalidate retained results.

#### Scenario: Repeated button toggle
- **WHEN** an owner clicks the main button after translation finishes and then clicks it again
- **THEN** it hides and restores the existing translations without retranslating the unchanged body
- **AND** Alt+T performs the same action

#### Scenario: Chinese wiki page
- **GIVEN** a wiki page with `language: zh`
- **WHEN** an owner opens it
- **THEN** the action reads "Translate to English" and enabling it shows English translations beside the Chinese originals

