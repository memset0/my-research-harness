## Context

The InboxShell is shared between Reports and Digests. The relevant
chunk:

```tsx
<main className="min-w-0 flex-1 overflow-y-auto">
  <SelectedItemPane …>
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10 flex … border-b … px-4 py-2 …">…</div>
      <div className="flex flex-1 overflow-hidden">
        <div className="overflow-y-auto min-w-0 flex-1">
          <div className="p-4 md:p-6"><RenderedItem /></div>
        </div>
      </div>
    </div>
  </SelectedItemPane>
</main>
```

The CSS Overflow Module Level 3 specifies that when `overflow-x` and
`overflow-y` differ, and one is `visible` while the other is not,
the `visible` value computes to `auto`. So `overflow-y-auto` alone
implies `overflow-x: auto` at compute time. That's the "auto-x
trap": you wanted a vertical scroller, you got a bidirectional one.

Inside the body row (`flex flex-1 overflow-hidden`) horizontal
overflow is clipped explicitly. Outside that row — at the `<main>`
and at the inner content scroll div — the auto-x rule still
applies.

## Goals / Non-Goals

**Goals:**
- No horizontal scrollbar on the inbox detail pane regardless of
  content width (long pre lines, long unbreakable inline tokens,
  etc.). The prose's own `<pre>` keeps its internal `overflow-x:
  auto` for code overflow — that's the right level for that
  affordance.

**Non-Goals:**
- No reflow or resizing of the rendered area.
- No change to how the editor side-pane lays out (it still has
  `md:flex md:w-[28rem] md:flex-col` and is unaffected).
- Not switching `<main>`'s `overflow-y-auto` to `overflow-hidden`
  even though the inner content scroll already handles vertical
  scroll. Making main `overflow-hidden` would also fix the auto-x
  trap, but it changes the semantic that "main can scroll if its
  inner content somehow exceeds it" (e.g. a very tall sticky
  header). Cleaner to keep both axes explicit.

## Decisions

**D1. `overflow-x-hidden` paired with `overflow-y-auto` is the
minimal fix.** Tailwind's `overflow-x-hidden` writes
`overflow-x: hidden`. Combined with `overflow-y-auto`, the resulting
declarations are explicit on both axes and the auto-x rule no longer
applies. No content is actually clipped because the inner content
already fits horizontally (with `min-w-0` propagation in place).

**D2. Apply on both layers.** The `<main>` and the inner content
scroll both have the trap. Belt-and-braces: clip on both. The cost
is one Tailwind class per layer.

**D3. Don't add overflow-x-hidden to the body root or the
SidebarInset.** Those are not the source of the trap, and adding
clip there could mask other bugs.

## Risks / Trade-offs

- [Risk] `overflow-x-hidden` is a "hide the symptom" fix that masks
  any future case of horizontal overflow that should be visible. →
  Mitigation: the spec scenario explicitly says no horizontal
  scrollbar on the inbox detail pane is desired; if a future
  layout legitimately needs horizontal scroll there, the spec
  scenario gets revised and the class drops.

## Migration Plan

Code-only edit. Restart picks it up.

## Open Questions

None.
