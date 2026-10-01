## ADDED Requirements

### Requirement: Whole-file replacement writes are atomic

Every whole-file replacement memon performs on project or local state files
(README writes, Run archive and deprecation flags, Experiment renames,
journal appends, commit-mark and wiki review CSVs, Report writes, Warnings
writes, wiki page writes, results annotations) SHALL write the complete new
content to a hidden temporary file in the same directory and then rename it
over the target, so a reader never observes partial content. The write SHALL
NOT fsync by default; a caller MAY request fsync explicitly. When the write
or rename fails, the temporary file SHALL be removed and the original target
SHALL be left unchanged. A requested file mode SHALL be applied to the new
file.

#### Scenario: Failed rename leaves no temp file
- **GIVEN** a target whose rename fails
- **WHEN** an atomic replacement is attempted
- **THEN** the error is reported, the target keeps its old content, and no
  temporary file remains in the directory

#### Scenario: Successful write replaces content in one step
- **WHEN** an atomic replacement of `README.md` succeeds
- **THEN** `README.md` holds exactly the new content and the directory
  contains no temporary file
