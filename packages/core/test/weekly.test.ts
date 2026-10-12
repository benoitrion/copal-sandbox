import { test } from "node:test";
import * as assert from "node:assert/strict";
import { LADDER, nextPractice, practice, startingPractice, weeklyReport, weeklyReportToMarkdown } from "../src";
import type { PullRecord } from "../src";

const now = Date.parse("2026-10-12T12:00:00Z");
const at = (h: number) => new Date(now - h * 36e5).toISOString();
const pr = (n: number, size: number, tests: boolean, reviewH: number | null): PullRecord => ({
  number: n, author: "a", createdAt: at(30), mergedAt: at(4), firstCommitAt: at(40),
  files: [{ filename: "src/x.ts", additions: size, deletions: 0 }, ...(tests ? [{ filename: "src/x.test.ts", additions: 10, deletions: 0 }] : [])],
  reviews: reviewH == null ? [] : [{ author: "b", submittedAt: at(30 - reviewH) }],
});

test("weekly: disciplines, focus and practice", () => {
  const r = weeklyReport({ pulls: [pr(1, 600, false, 2), pr(2, 500, false, 3), pr(3, 450, true, 1)], now });
  assert.equal(r.changes, 3);
  const steps = r.disciplines.find((d) => d.id === "steps")!;
  assert.equal(steps.status, "needs practice");
  assert.equal(r.disciplines.find((d) => d.id === "examples")!.status, "needs practice");
  assert.equal(r.disciplines.find((d) => d.id === "review")!.status, "strong");
  assert.ok(r.focus && ["examples", "steps"].includes(r.focus.discipline));
  assert.ok(practice(r.focus!.practice));
});

test("weekly: trend against previous week", () => {
  const r = weeklyReport({ pulls: [pr(1, 100, true, 2)], previous: [pr(9, 600, false, 2)], now });
  assert.equal(r.disciplines.find((d) => d.id === "steps")!.trend, "better");
  assert.equal(r.disciplines.find((d) => d.id === "examples")!.trend, "better");
});

test("weekly: delivery metrics only when data allows", () => {
  const without = weeklyReport({ pulls: [pr(1, 100, true, 2)], now });
  assert.equal(without.delivery[0].value, 36);
  assert.equal(without.delivery[1].value, null);
  assert.match(without.delivery[1].note!, /Not measured/);
  const withDeploys = weeklyReport({ pulls: [pr(1, 100, true, 2)], deployments: [{ at: at(2) }, { at: at(1), failed: true }], incidents: [{ openedAt: at(3), resolvedAt: at(1) }], now });
  assert.equal(withDeploys.delivery[0].value, 38);
  assert.deepEqual(withDeploys.delivery.map((d) => d.name), ["Change lead time", "Deployment frequency", "Failed deployment recovery time", "Change fail rate", "Deployment rework rate"]);
  assert.equal(withDeploys.delivery[3].value, 0.5);
  assert.equal(withDeploys.delivery[2].value, null);
  assert.equal(withDeploys.delivery[4].value, 1);
  assert.match(weeklyReportToMarkdown(withDeploys), /Change fail rate \| 50%/);
  const recovered = weeklyReport({ pulls: [pr(1, 100, true, 2)], deployments: [{ at: at(5), failed: true }, { at: at(2) }], now });
  assert.equal(recovered.delivery[2].value, 3);
  assert.equal(recovered.delivery[4].value, null);
});

test("ladder: three rungs per discipline, start and next", () => {
  for (const d of ["examples", "scope", "steps"] as const) assert.deepEqual(LADDER.filter((p) => p.discipline === d).map((p) => p.rung), [1, 2, 3]);
  assert.equal(startingPractice("examples", "needs practice").id, "examples-1");
  assert.equal(startingPractice("scope", "strong").id, "scope-3");
  assert.equal(nextPractice("steps-1")!.id, "steps-2");
  assert.equal(nextPractice("steps-3"), undefined);
});
