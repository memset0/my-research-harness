## 1. Stabilize the review-rejection test

- [x] 1.1 In `packages/backend/src/wiki-service.test.ts`, "leaves review unchecked for a Project with no execution target": settle `wikiReviewLog`, `markWikiReview` and `unmarkWikiReview` with `Promise.allSettled` before asserting, then assert each result is `rejected` with `reason.code === 'EXECUTION_UNAVAILABLE'`; verify the assertions still cover all three operations and the no-`wiki-review.csv` check
- [x] 1.2 Grep the same file for any other loop that creates rejecting promises before attaching handlers and fix it the same way; verify by recording the grep result (other loops create each promise inside its own iteration and need no change)
- [x] 1.3 Run `pnpm --filter @memon/backend exec vitest run src/wiki-service.test.ts` five times in a row; verify all five runs pass with no unhandled errors
- [x] 1.4 Run `pnpm --filter @memon/backend typecheck` (or the backend lint/typecheck hook) and verify it passes
