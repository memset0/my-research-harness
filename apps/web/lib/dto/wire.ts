// Structural view of a DTO as the backend wire schemas type it.
//
// The shared backend protocol (zod schemas in `@memon/core`) types enum-like
// fields — Run/Experiment/Hypothesis statuses, managed-document kinds — as
// plain strings, while the client DTOs keep the narrow domain unions the UI
// switches on. `Wire<T>` widens every string-literal union in `T` to `string`
// (recursively) so a route handler can still be checked field-by-field
// against the client DTO with `satisfies Wire<Dto>`: missing, extra or
// differently shaped fields fail typecheck; only enum precision is relaxed.

export type Wire<T> = T extends string
  ? string
  : T extends number | boolean | bigint | null | undefined
    ? T
    : T extends readonly (infer Item)[]
      ? Wire<Item>[]
      : T extends object
        ? { [Key in keyof T]: Wire<T[Key]> }
        : T
