## ADDED Requirements

### Requirement: Research notes and diagnostics have separate controls

The dashboard SHALL remove AddJournalEntryButton and Journal-targeting NOTE/REQUEST actions for every role, including owner. These retired controls are no longer part of the existing ViewerGuard required wrap set; supported mutation/shell controls SHALL retain the same protection. Existing AddNote actions that write canonical document content SHALL not be removed merely because they are named notes. Diagnostic history SHALL be explicitly read-only, and new receipt details SHALL be owner-only.

#### Scenario: Owner cannot author Journal prose
- **WHEN** the owner opens Journal or an Experiment detail
- **THEN** no control writes a manual Journal note while supported document editing remains available
