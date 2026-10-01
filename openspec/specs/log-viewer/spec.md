# log-viewer Specification

## Purpose
Defines how the dashboard shows a Run's log files: a default tail with absolute line numbers, scroll-up paging, SSE auto-follow while scrolled to the bottom, and line-range reads. It relies on a cached, incrementally updated `LineIndex`, optionally persisted to disk, so large logs are never loaded whole. The index lives in `@memon/core` (`log/`); the viewer and `/api/log` routes live in `apps/web`, with the richer tools specified by `log-viewer-tools`.

## Requirements
### Requirement: Default tail of last 100 lines with absolute line numbers

When the user opens a log file in the web UI, the system SHALL initially display the last 100 lines of the file, each prefixed by its absolute line number (1-indexed from file start).

#### Scenario: File with 50,000 lines
- **WHEN** the user opens a 50,000-line log
- **THEN** the viewer displays lines 49,901 through 50,000 with their absolute line numbers

#### Scenario: File with fewer than 100 lines
- **WHEN** the user opens a 30-line log
- **THEN** the viewer displays all 30 lines with line numbers 1 through 30

### Requirement: Infinite scroll up to load earlier lines

When the user scrolls to the top of the currently rendered region, the system SHALL load the prior 100 lines and prepend them, preserving the user's visual position relative to the boundary.

#### Scenario: Scroll to top triggers prefetch
- **WHEN** the viewer's scroll position reaches the top of the rendered range and earlier lines exist
- **THEN** the frontend issues a request for the prior 100 lines and prepends them to the rendered list, with the user's visible content unchanged

#### Scenario: Scroll to file head
- **WHEN** the user has scrolled all the way to line 1 and triggers another prefetch
- **THEN** the request returns an empty range and the viewer displays a "start of file" indicator

### Requirement: SSE auto-follow when at bottom

When the user is positioned at the bottom of the viewer (or returns to it), the system SHALL stream newly appended lines via Server-Sent Events and append them in real time. When the user scrolls up, follow mode SHALL automatically pause; when the user scrolls back to the bottom, follow mode SHALL automatically resume.

#### Scenario: Follow mode appends new lines
- **WHEN** the user is at the bottom and the underlying file has 10 new lines appended
- **THEN** the viewer appends those 10 lines without scrolling jump and stays at the bottom

#### Scenario: Pause on scroll up
- **WHEN** the user scrolls up away from the bottom
- **THEN** follow mode is automatically paused; new lines arriving via SSE are buffered and reflected in a "N new lines" indicator instead of forcing a scroll

#### Scenario: Resume on scroll back
- **WHEN** the user scrolls back to the bottom of the viewer
- **THEN** follow mode resumes, the buffered lines are flushed into the rendered list, and the indicator is cleared

### Requirement: LineIndex caching with incremental update on append

The backend SHALL maintain a per-file `LineIndex` mapping line numbers to byte offsets to support O(1) random access by line number. The index SHALL be built lazily on first access and updated incrementally when the file is appended (not rebuilt from scratch).

#### Scenario: First access on a 5GB log
- **WHEN** the user opens a 5GB log file for the first time
- **THEN** the backend streams a one-pass scan to build the LineIndex, producing partial progress events; once the index is ready, the requested 100 lines are returned

#### Scenario: Append during follow mode
- **WHEN** the file is appended with 200 new lines while the index is loaded
- **THEN** the next poll detects the size change, reads only the new bytes, extends the index by 200 entries, and pushes those lines via SSE

#### Scenario: File truncated or rotated
- **WHEN** the file's size shrinks or its inode changes
- **THEN** the LineIndex is invalidated and rebuilt on next access

### Requirement: Optional disk persistence of LineIndex

The backend MAY persist `LineIndex` data to `~/.cache/memon/lineindex/<sha1-of-path>.bin` to accelerate reopens. The persistence is best-effort; failure to read the cache SHALL fall back to in-memory rebuild.

#### Scenario: Cache hit on reopen
- **WHEN** the same large log is reopened in a later session and a valid disk cache exists (matching mtime + size)
- **THEN** the index is loaded from disk in under 100ms instead of re-scanning the file

#### Scenario: Stale cache invalidated
- **WHEN** the disk cache exists but the file's `mtime` or `size` no longer matches the cache header
- **THEN** the cache is discarded and rebuilt

### Requirement: Range API for line-bounded reads

The backend SHALL expose `GET /api/log?path=<path>&endLine=<N>&count=<C>` returning the lines `[N - C + 1 .. N]` inclusive, with absolute line numbers. The path parameter SHALL be confined to inside one of the configured project roots; out-of-scope paths SHALL be rejected with HTTP 403.

#### Scenario: Valid in-scope range
- **WHEN** the request is for a file inside a configured project root with a valid range
- **THEN** the response is 200 with a JSON body containing `lines: [{lineNumber, text}, ...]` of length up to `C`

#### Scenario: Path traversal rejected
- **WHEN** the requested `path` resolves (after normalization) to outside any configured project root
- **THEN** the response is 403 with no file contents

