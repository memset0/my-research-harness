## Context

Reset view calls `setStoredPreferences(DEFAULT_PREFERENCES)` directly. Both localStorage and the owner SQLite queue observe that replacement immediately, and neither store retains preference history.

## Decision

Use the existing shadcn Dialog primitives as a controlled confirmation surface. The toolbar button only opens the dialog. The dialog names the destructive scope and provides Cancel plus a destructive Confirm reset action. Only the confirm handler invokes the existing reset function and closes the dialog.

The dialog's initial focus is directed to Cancel. Escape, the close path, and cancellation only change dialog-open state. Reset remains disabled when there is nothing persistent or temporary to reset, matching current behavior.

## Risks / Trade-offs

- Confirmation adds one click to intentional resets; this is appropriate because the operation has no undo/history.
- The dialog prevents future accidental resets but cannot reconstruct preferences already overwritten before this change.
