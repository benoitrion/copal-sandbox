import type { Metrics } from "./types";
export const metrics = {
 "analyses": 11,
 "bySource": {
  "pr": 6,
  "precommit": 4,
  "branch": 1
 },
 "drift": [
  {
   "ruleId": "hardcoded-credentials",
   "count": 5,
   "falsePositives": 0
  },
  {
   "ruleId": "invoice-contract-test",
   "count": 4,
   "falsePositives": 1
  },
  {
   "ruleId": "approved-dependencies",
   "count": 4,
   "falsePositives": 0
  },
  {
   "ruleId": "ledger-rounding",
   "count": 3,
   "falsePositives": 0
  },
  {
   "ruleId": "sql-injection",
   "count": 2,
   "falsePositives": 0
  },
  {
   "ruleId": "ui-no-persistence",
   "count": 2,
   "falsePositives": 0
  },
  {
   "ruleId": "no-explicit-any",
   "count": 2,
   "falsePositives": 0
  },
  {
   "ruleId": "no-console",
   "count": 2,
   "falsePositives": 0
  }
 ],
 "gates": {
  "passed": 2,
  "failed": 4
 },
 "governedChanges": 4,
 "sessions": 1,
 "tokens": 18250
} satisfies Metrics;
