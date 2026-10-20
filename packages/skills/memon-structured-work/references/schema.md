# Optional phase documents

Each file has `schema_version: 1` and an `items` list. Each item requires a
stable `id`, nonempty `title` and `status`. Preserve unknown existing fields.

| File | ID | Status values |
|---|---|---|
| implementation.yaml | IMP0001 | TODO, IN_PROGRESS, BLOCKED, DONE, DROPPED |
| investigation.yaml | INV0001 | PLANNED, IN_PROGRESS, BLOCKED, ANSWERED, INCONCLUSIVE, DROPPED |

```yaml
schema_version: 1
items:
  - id: IMP0001
    title: Compare the two implementations
    status: TODO
```

Both support optional `description`, `depends_on` (IDs), `outcome` and nested
`children` with the same item shape. Implementation additionally accepts
`acceptance_criteria`, `files`, `code_reviews` (string lists), and `commits`
(objects with `repo`, `sha`, optional `url`). Investigation additionally accepts
`question`, `rationale`, `success_criteria` and `variant_ids` (the latter two lists).
Use only useful fields; a completed task is not a research conclusion.

When that view is wanted, add the corresponding README H2 and pointer:

```markdown
## Implementation

> Managed in [implementation.yaml](./implementation.yaml); read and update that file directly.
```

For investigation use `Investigation` and `investigation.yaml`. Read and check
with `memon --project-root . show <E-id> --section implementation` or
`--section investigation`, then `refresh <E-id>` to publish.
