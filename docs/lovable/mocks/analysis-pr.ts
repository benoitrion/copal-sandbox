import type { Analysis } from "./types";
export const analysis_pr = {
 "environment": "ci",
 "findings": [
  {
   "ruleId": "approved-dependencies",
   "category": "dependency",
   "severity": "error",
   "mode": "enforce",
   "blocking": true,
   "file": "package.json",
   "line": 9,
   "message": "Dependency \"moment\" is on the deny list",
   "why": "New packages need a security and licence review (#platform-deps).",
   "column": 5,
   "endColumn": 13
  },
  {
   "ruleId": "approved-dependencies",
   "category": "dependency",
   "severity": "error",
   "mode": "enforce",
   "blocking": true,
   "file": "package.json",
   "line": 11,
   "message": "Dependency \"some-unreviewed-sdk\" is not on the approved list",
   "why": "New packages need a security and licence review (#platform-deps).",
   "column": 5,
   "endColumn": 26
  },
  {
   "ruleId": "sql-injection",
   "category": "security",
   "severity": "error",
   "mode": "enforce",
   "blocking": true,
   "file": "src/persistence/invoice-repo.ts",
   "line": 9,
   "message": "SQL built by string concatenation/interpolation",
   "why": "Use parameterised queries so user input can never change the statement.",
   "column": 19,
   "endColumn": 73
  },
  {
   "ruleId": "hardcoded-credentials",
   "category": "security",
   "severity": "error",
   "mode": "enforce",
   "blocking": true,
   "file": "src/persistence/invoice-repo.ts",
   "line": 12,
   "message": "Hard-coded credential detected (customer-iban: BE71\u20266769)",
   "why": "Credentials in source end up in git history, prompts and logs. Load them from the secret manager.",
   "column": 50,
   "endColumn": 66
  }
 ],
 "blocking": true,
 "summary": {
  "total": 4,
  "blocking": 4,
  "audit": 0,
  "byCategory": {
   "dependency": 2,
   "security": 2
  }
 },
 "filesChecked": 2,
 "rulesEvaluated": 9,
 "project": "billing-api",
 "source": "pr",
 "ref": "acme/billing-api#250",
 "title": "feat: customer invoice search (authored with Codex)",
 "author": "e2e",
 "id": "an_9295db2354",
 "createdAt": "2026-10-08T11:30:43.932Z",
 "feedback": []
} satisfies Analysis;
