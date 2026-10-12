/**
 * Practice ladder: three rungs per discipline, from a guided exercise to doing it on the team's own code.
 * The diagnostic picks the starting rung; recurring findings or a slipping weekly metric suggest the next one.
 * External katas are linked and credited, never copied.
 */
import type { DisciplineId, Level } from "./weekly";

export interface Practice {
  id: string;
  discipline: Exclude<DisciplineId, "review">;
  rung: 1 | 2 | 3;
  title: string;
  goal: string;
  steps: string[];
  doneWhen: string;
  /** Optional exercise repository or description (credited to its authors). */
  kata?: { name: string; url: string; credit: string };
  minutes: number;
}

export const LADDER: Practice[] = [
  {
    id: "examples-1", discipline: "examples", rung: 1, minutes: 45,
    title: "Test first on a small kata",
    goal: "Feel the loop: example, failing test, code, green.",
    steps: ["Pick the first requirement of the kata.", "Write it as a failing test.", "Make it pass with the simplest code.", "Repeat for the next requirement, without the AI."],
    doneWhen: "Every requirement has a test written before its code.",
    kata: { name: "String Calculator", url: "https://sammancoaching.org/kata_descriptions/string_calculator.html", credit: "Roy Osherove · Samman Coaching" },
  },
  {
    id: "examples-2", discipline: "examples", rung: 2, minutes: 60,
    title: "Tests first, AI implements",
    goal: "Use examples as the AI's specification.",
    steps: ["Write the examples for one business rule as tests.", "Ask your AI assistant to make them pass, and nothing else.", "Reject any code no test asked for.", "Compare the result with a prompt-only attempt."],
    doneWhen: "The AI's change passes your tests and adds no untested behaviour.",
    kata: { name: "Supermarket Receipt", url: "https://github.com/emilybache/SupermarketReceipt-Refactoring-Kata", credit: "Emily Bache" },
  },
  {
    id: "examples-3", discipline: "examples", rung: 3, minutes: 90,
    title: "Pin down legacy behaviour",
    goal: "Write characterisation tests before letting AI change old code.",
    steps: ["Choose a module your team is afraid to touch.", "Record what it does today as tests, including odd cases.", "Only then ask the AI for the change.", "Keep the tests in the change."],
    doneWhen: "A real change to legacy code lands with the tests that protected it.",
    kata: { name: "Gilded Rose", url: "https://github.com/emilybache/GildedRose-Refactoring-Kata", credit: "Emily Bache" },
  },
  {
    id: "scope-1", discipline: "scope", rung: 1, minutes: 30,
    title: "One-line brief",
    goal: "Agree the scope before the first prompt.",
    steps: ["Before your next task, write: goal, in scope, out of scope.", "Give the brief to the AI with the task.", "Run Copal's scope check before review."],
    doneWhen: "Three changes in a row with no out-of-scope question.",
  },
  {
    id: "scope-2", discipline: "scope", rung: 2, minutes: 60,
    title: "Give the AI only one slice",
    goal: "Limit the context to the module the change belongs to.",
    steps: ["Find the boundary of the module you are changing.", "Give the AI only that module and its tests.", "If it needs another module, stop and decide whether that is a separate change."],
    doneWhen: "The change touches one module and its tests.",
    kata: { name: "Theatrical Players", url: "https://github.com/emilybache/Theatrical-Players-Refactoring-Kata", credit: "Emily Bache" },
  },
  {
    id: "scope-3", discipline: "scope", rung: 3, minutes: 90,
    title: "Draw a boundary as a team rule",
    goal: "Turn an architecture decision into a rule Copal checks.",
    steps: ["Pick one dependency that should never happen (for example, UI to database).", "Write it as a deny rule in .copalrules, with the question to ask.", "Fix or justify the existing violations."],
    doneWhen: "The rule runs on every change and the team agrees with its question.",
  },
  {
    id: "steps-1", discipline: "steps", rung: 1, minutes: 45,
    title: "Split a change in three",
    goal: "See that a feature can land as several small, safe changes.",
    steps: ["Take your next feature.", "Plan it as: rule and its test, then the wiring, then the screen.", "Submit each part as its own change."],
    doneWhen: "Each part is under 400 lines and was reviewed on its own.",
  },
  {
    id: "steps-2", discipline: "steps", rung: 2, minutes: 60,
    title: "Commit on every green",
    goal: "Work in steps small enough to undo without thinking.",
    steps: ["Run the tests after each small edit, by you or the AI.", "Commit every time they pass.", "Revert instead of debugging when a step goes red."],
    doneWhen: "A session with a commit every few minutes and no long red phase.",
    kata: { name: "Gilded Rose", url: "https://github.com/emilybache/GildedRose-Refactoring-Kata", credit: "Emily Bache" },
  },
  {
    id: "steps-3", discipline: "steps", rung: 3, minutes: 90,
    title: "Ship behind a flag",
    goal: "Merge unfinished work safely instead of growing a big branch.",
    steps: ["Put the new behaviour behind a flag that is off.", "Merge small steps daily.", "Turn it on when the last step is verified."],
    doneWhen: "A feature reached production as several merged steps.",
  },
];

export function practice(id: string): Practice | undefined {
  return LADDER.find((p) => p.id === id);
}

/** Starting rung from a discipline's status: needs practice → 1, fair → 2, strong → 3. */
export function startingPractice(discipline: Practice["discipline"], status: Level): Practice {
  const rung = status === "strong" ? 3 : status === "fair" ? 2 : 1;
  return LADDER.find((p) => p.discipline === discipline && p.rung === rung)!;
}

/** Next rung after `id` is done, or undefined at the top. */
export function nextPractice(id: string): Practice | undefined {
  const p = practice(id);
  return p && LADDER.find((q) => q.discipline === p.discipline && q.rung === p.rung + 1);
}
