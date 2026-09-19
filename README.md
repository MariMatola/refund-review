# refund-review

Code review exercise: `processRefund` — old (buggy) and new (fixed) versions, tested with Jest.

## Structure

```
src/
  types.ts              — Transaction type
  deps.ts                — Db/Stripe interfaces + injected db/stripe (mocked in tests)
  processRefund.old.ts   — buggy version
  processRefund.new.ts   — fixed version
tests/
  processRefund.test.ts  — tests, run against whichever version is imported
```

## Running tests

```bash
npm install
npm test
```

`tests/processRefund.test.ts` imports `processRefund` from a single line:

```ts
import { processRefund } from "../src/processRefund.old";
```

The tests assert correct behavior, so as-is they **fail** against `processRefund.old.ts` — that's expected, it documents the bugs. Swap the import to `../src/processRefund.new` to run the same tests against the fixed version, where they should all pass.
