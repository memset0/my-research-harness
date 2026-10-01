## MODIFIED Requirements

### Requirement: shadcn primitives replace hand-rolled UI components

The repo SHALL adopt shadcn/ui versions of its UI primitives (including `Button`, `Card`, `Badge`, `Dialog`, `AlertDialog`, `Tabs`, `Tooltip`, `Collapsible`, `DropdownMenu`, `ContextMenu`, `Popover`, `HoverCard`, `Table`, `ScrollArea`, `Separator`, and `Sidebar`). Each primitive file under `apps/web/components/ui/` SHALL be the output of the shadcn CLI (`shadcn add <name>`, run non-interactively against the committed `components.json` from a real `shadcn init`) and SHALL NOT be edited by hand. Domain-specific variants, extra exports, or styling SHALL live in wrapper components outside `components/ui/` that compose the primitive, so re-running `shadcn add <name> --overwrite` never discards application behavior.

Owner-facing confirmation prompts (for example discarding an unsaved draft or removing a verification mark) SHALL use the shadcn `AlertDialog` primitive with a Cancel action and an explicit confirm action. The Web app SHALL NOT call the browser-native `window.confirm`, `window.alert`, or `window.prompt`.

#### Scenario: Primitive regeneration is lossless
- **WHEN** `shadcn add <name> --overwrite --yes` is re-run for any primitive under `apps/web/components/ui/`
- **THEN** the working tree shows no diff for that file, and every application import still resolves and type-checks

#### Scenario: No breaking import changes
- **WHEN** application components import a primitive from `@/components/ui/<name>` (or the equivalent relative path) after that primitive is regenerated
- **THEN** those imports continue to resolve; any export the app needs that upstream does not provide comes from a wrapper component outside `components/ui/`

#### Scenario: Manual install (not interactive)
- **WHEN** a new shadcn component is added to the repo
- **THEN** it is installed with the non-interactive `shadcn add <name> --yes` using the committed `components.json` from a real `shadcn init`, not hand-written or copied into `apps/web/components/ui/`

#### Scenario: Confirmation uses AlertDialog
- **WHEN** the owner triggers an action that requires confirmation, such as switching commits with an unsaved note draft or unverifying a wiki review commit
- **THEN** a themed AlertDialog opens with Cancel and a confirm action
- **AND** choosing Cancel, pressing Escape, or closing the dialog leaves state unchanged
- **AND** only the confirm action performs the original effect
