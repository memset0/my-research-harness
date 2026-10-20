## Why

Wiki pages should be readable research documents without a mandatory human verification ledger. The commit-based review layer adds Git queries, metadata, UI controls, and maintenance unrelated to displaying evidence and conclusions.

## What Changes

- **BREAKING** Remove Wiki review marks, review CLI/API operations, and review fields from Wiki projections.
- Remove review badges, the review History panel, changes-since-verification links, and line-range review decoration.
- Stop reading the review CSV and Git HEAD/log/blame while loading or refreshing Wiki documents.
- Preserve ordinary Git history, document editing with optimistic locks, callouts, HTML, checklists, and existing historical files.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `wiki-store`: remove review persistence and derivation; keep Wiki reads independent of Git.
- `wiki-viewer`: remove human-review presentation and actions.
- `memon-wiki-skill`: remove instructions for retired review commands and review-state conflict ranking.

## Impact

Core Wiki types, projections and lint; backend Wiki services and routes; CLI Wiki commands; Web Wiki components, API/query contracts and focused tests. Old `.memon/wiki-review.csv` files remain untouched and ignored. This change only corrects obsolete review guidance in bundled skills; it does not redesign their workflows or Wiki content.
