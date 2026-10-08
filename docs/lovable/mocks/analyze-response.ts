import type { Report } from "./types";
export const analyze_response = {
 "environment": "local",
 "findings": [
  {
   "ruleId": "ledger-rounding",
   "category": "architecture",
   "severity": "error",
   "mode": "enforce",
   "blocking": true,
   "file": "src/invoice/total.ts",
   "line": 8,
   "message": "Inline rounding bypasses LedgerPort",
   "why": "Rounding in one place keeps invoices and the ledger reconciled.",
   "sources": [
    "rule ledger-rounding",
    "Jira FIN-402"
   ],
   "column": 17,
   "endColumn": 44,
   "suggestion": {
    "original": "  const total = Math.round(sum * 100) / 100;",
    "replacement": "  const total = LedgerPort.round(sum, Currency.EUR);"
   }
  },
  {
   "ruleId": "hardcoded-credentials",
   "category": "security",
   "severity": "error",
   "mode": "enforce",
   "blocking": true,
   "file": "src/invoice/total.ts",
   "line": 12,
   "message": "Hard-coded credential detected (aws-access-key: AKIA\u20267Z2M)",
   "why": "Credentials in source end up in git history, prompts and logs. Load them from the secret manager.",
   "column": 14,
   "endColumn": 34
  },
  {
   "ruleId": "invoice-contract-test",
   "category": "testing",
   "severity": "warning",
   "mode": "audit",
   "blocking": false,
   "file": "src/invoice/total.ts",
   "line": 1,
   "message": "Change has no accompanying test (expected src/invoice/total.test.ts)",
   "why": "Invoice maths is contract-tested against the ledger fixtures."
  }
 ],
 "blocking": true,
 "summary": {
  "total": 3,
  "blocking": 2,
  "audit": 1,
  "byCategory": {
   "architecture": 1,
   "security": 1,
   "testing": 1
  }
 },
 "filesChecked": 1,
 "rulesEvaluated": 9,
 "analysisId": "an_76e5335131",
 "project": "billing-api"
} satisfies Report & { analysisId: string; project: string };
