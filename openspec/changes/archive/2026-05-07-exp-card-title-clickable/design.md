## Context

The header of an `ExperimentCard` is two stacked elements inside a
`<div className="flex flex-col gap-0.5 min-w-0">`:

```tsx
<Link href={…} className="truncate font-mono text-xs text-muted-foreground hover:underline">
  {exp.id}
</Link>
<h3 className="truncate text-sm font-medium">{exp.frontMatter.title}</h3>
```

The `<h3>` is plain text. Wrapping it in a Link makes the title
navigable.

## Goals / Non-Goals

**Goals:**
- Title click navigates to the exp detail page.
- Visual affordance matches existing link conventions
  (`hover:underline`).

**Non-Goals:**
- Don't make the entire `<article>` a single Link. The card has a
  nested `<table>` of run rows that already contain their own
  Links; nesting a Link around an element that contains other Links
  is invalid HTML and would suppress the inner Links' navigation.
- Don't wrap the existing inner `<div>` (containing both E-id and
  title) in one Link, for the same reason — the E-id is itself a
  Link.

## Decisions

**D1. Wrap the `<h3>` in `<Link>` with `asChild`-free semantics.**
Next.js `<Link>` accepts a child element and decorates it with
client-routing onClick. Using
`<Link><h3>…</h3></Link>` keeps the heading in the document outline
and gets routing for free. The Link's `className` carries the
hover affordance, leaving the h3 to keep its typography.

## Risks / Trade-offs

- [Risk] Two adjacent links (E-id + title) cluttering the
  accessibility tree. → Mitigation: both link to the same URL, so
  screen readers can just hear "link, E0001-foo" + "link, vpred
  convergence". Alternative would be a single combined link but
  that loses the visual distinction.

## Migration Plan

Code-only edit.

## Open Questions

None.
