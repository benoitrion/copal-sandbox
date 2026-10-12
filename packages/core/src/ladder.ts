/**
 * Practice ladder: three rungs per discipline. Rung 1 is a kata warm-up for the team's learning hour; rungs 2 and 3
 * are done on real work, because katas alone rarely change habits.
 * The diagnostic picks the starting rung; recurring findings or a slipping weekly metric suggest the next one.
 * External katas are linked and credited, never copied.
 */
import type { DisciplineId, Level } from "./weekly";

export type Track = "new-products" | "legacy" | "agents";

/** Tracks: the team's situation. They choose which disciplines to start with and swap in exercises that fit. */
export const TRACKS: Record<Track, { name: string; summary: string; emphasis: Practice["discipline"][] }> = {
  "new-products": { name: "New products", summary: "Build with AI from day one, without losing structure.", emphasis: ["examples", "steps", "scope"] },
  legacy: { name: "Legacy code", summary: "Change existing systems safely: pin down behaviour first, then change in small steps.", emphasis: ["examples", "scope", "steps"] },
  agents: { name: "AI agents", summary: "Keep agents inside a clear brief, one slice of the system, and reviewed steps.", emphasis: ["scope", "steps", "examples"] },
};

export interface Practice {
  id: string;
  discipline: Exclude<DisciplineId, "review">;
  rung: 1 | 2 | 3;
  /** Rung 1 is a warm-up in the team's learning hour; rungs 2 and 3 happen on real work, where habits stick. */
  where: "learning hour" | "your code";
  title: string;
  goal: string;
  steps: string[];
  doneWhen: string;
  /** Optional exercise repository or description (credited to its authors). */
  kata?: { name: string; url: string; credit: string };
  minutes: number;
  /** Track variant: replaces the default practice of the same discipline and rung for these tracks. */
  tracks?: Track[];
}

const PRACTICES: Practice[] = [
  {
    id: "examples-1", where: "learning hour", discipline: "examples", rung: 1, minutes: 45,
    title: "Test first on a small kata",
    goal: "Feel the loop: example, failing test, code, green.",
    steps: ["Pick the first requirement of the kata.", "Write it as a failing test.", "Make it pass with the simplest code.", "Repeat for the next requirement, without the AI."],
    doneWhen: "Every requirement has a test written before its code.",
    kata: { name: "String Calculator", url: "https://sammancoaching.org/kata_descriptions/string_calculator.html", credit: "Roy Osherove · Samman Coaching" },
  },
  {
    id: "examples-2", where: "your code", discipline: "examples", rung: 2, minutes: 60,
    title: "Tests first, AI implements",
    goal: "Use examples as the AI's specification.",
    steps: ["Take your next real task.", "Write the examples for its business rule as tests.", "Ask your AI assistant to make them pass, and nothing else.", "Reject any code no test asked for."],
    doneWhen: "A real change lands where the AI's code passes your tests and adds no untested behaviour.",
  },
  {
    id: "examples-3", where: "your code", discipline: "examples", rung: 3, minutes: 90,
    title: "Pin down legacy behaviour",
    goal: "Write characterisation tests before letting AI change old code.",
    steps: ["Choose a module your team is afraid to touch.", "Record what it does today as tests, including odd cases.", "Only then ask the AI for the change.", "Keep the tests in the change."],
    doneWhen: "A real change to legacy code lands with the tests that protected it.",
    kata: { name: "Gilded Rose", url: "https://github.com/emilybache/GildedRose-Refactoring-Kata", credit: "Emily Bache" },
  },
  {
    id: "scope-2", where: "your code", discipline: "scope", rung: 2, minutes: 30,
    title: "One-line brief",
    goal: "Agree the scope before the first prompt.",
    steps: ["Before your next task, write: goal, in scope, out of scope.", "Give the brief to the AI with the task.", "Run Copal's scope check before review."],
    doneWhen: "Three changes in a row with no out-of-scope question.",
  },
  {
    id: "scope-1", where: "learning hour", discipline: "scope", rung: 1, minutes: 60,
    title: "Give the AI only one slice",
    goal: "Limit the context to the part of the code the change belongs to.",
    steps: ["Pick one change in the kata.", "Give the AI only the code that change belongs to, and its tests.", "If it asks for more, stop and discuss whether that is a separate change."],
    doneWhen: "The change touches one part of the code and its tests.",
    kata: { name: "Theatrical Players", url: "https://github.com/emilybache/Theatrical-Players-Refactoring-Kata", credit: "Emily Bache" },
  },
  {
    id: "scope-3", where: "your code", discipline: "scope", rung: 3, minutes: 90,
    title: "Draw a boundary as a team rule",
    goal: "Turn an architecture decision into a rule Copal checks.",
    steps: ["Pick one dependency that should never happen (for example, UI to database).", "Write it as a deny rule in .copalrules, with the question to ask.", "Fix or justify the existing violations."],
    doneWhen: "The rule runs on every change and the team agrees with its question.",
  },
  {
    id: "steps-2", where: "your code", discipline: "steps", rung: 2, minutes: 45,
    title: "Split a change in three",
    goal: "See that a feature can land as several small, safe changes.",
    steps: ["Take your next feature.", "Plan it as: rule and its test, then the wiring, then the screen.", "Submit each part as its own change."],
    doneWhen: "Each part is under 400 lines and was reviewed on its own.",
  },
  {
    id: "steps-1", where: "learning hour", discipline: "steps", rung: 1, minutes: 60,
    title: "Commit on every green",
    goal: "Work in steps small enough to undo without thinking.",
    steps: ["Run the tests after each small edit, by you or the AI.", "Commit every time they pass.", "Revert instead of debugging when a step goes red."],
    doneWhen: "A session with a commit every few minutes and no long red phase.",
    kata: { name: "Gilded Rose", url: "https://github.com/emilybache/GildedRose-Refactoring-Kata", credit: "Emily Bache" },
  },
  {
    id: "steps-3", where: "your code", discipline: "steps", rung: 3, minutes: 90,
    title: "Ship behind a flag",
    goal: "Merge unfinished work safely instead of growing a big branch.",
    steps: ["Put the new behaviour behind a flag that is off.", "Merge small steps daily.", "Turn it on when the last step is verified."],
    doneWhen: "A feature reached production as several merged steps.",
  },
];

/** Track variants: same discipline and rung, an exercise that fits the team's situation. */
const VARIANTS: Practice[] = [
  {
    id: "legacy-examples-2", tracks: ["legacy"], where: "your code", discipline: "examples", rung: 2, minutes: 60,
    title: "Pin down behaviour before any change",
    goal: "Never let the AI change old code that no test describes.",
    steps: ["Before your next change to old code, write tests for what it does today.", "Include the odd cases you find, even if they look wrong.", "Only then ask the AI for the change, and keep the tests."],
    doneWhen: "A real change to old code lands with the tests that protected it.",
  },
  {
    id: "legacy-steps-2", tracks: ["legacy"], where: "your code", discipline: "steps", rung: 2, minutes: 60,
    title: "Refactor in tiny steps",
    goal: "Change old code one safe move at a time.",
    steps: ["With the tests green, make one small refactoring (rename, extract, move).", "Run the tests and commit.", "Ask the AI for one move at a time, never a rewrite."],
    doneWhen: "A messy function was improved through several green commits.",
    kata: { name: "Gilded Rose", url: "https://github.com/emilybache/GildedRose-Refactoring-Kata", credit: "Emily Bache" },
  },
  {
    id: "agents-scope-2", tracks: ["agents"], where: "your code", discipline: "scope", rung: 2, minutes: 30,
    title: "Brief every agent task",
    goal: "An agent gets a goal, a scope and a definition of done before it starts.",
    steps: ["Write the brief: goal, in scope, out of scope, done when.", "Ask the agent for a plan and review it before any code.", "Run Copal's scope check on the result."],
    doneWhen: "Three agent tasks in a row stayed inside their brief.",
  },
  {
    id: "agents-steps-2", tracks: ["agents"], where: "your code", discipline: "steps", rung: 2, minutes: 45,
    title: "Agents work in reviewed steps",
    goal: "Stop the agent after each verified step instead of reviewing one big result.",
    steps: ["Ask the agent to stop when one test passes.", "Read that diff and commit it.", "Only then let it continue with the next step."],
    doneWhen: "An agent task landed as several small, reviewed commits.",
  },
  {
    id: "agents-examples-2", tracks: ["agents"], where: "your code", discipline: "examples", rung: 2, minutes: 45,
    title: "Tests are the agent's contract",
    goal: "The agent implements your examples and may not change them.",
    steps: ["Write the tests yourself first.", "Tell the agent it must not edit test files.", "Reject any change that touches them."],
    doneWhen: "An agent change passed tests it did not write or modify.",
  },
];

const ORDER = ["examples", "scope", "steps"];
export const LADDER: Practice[] = [...PRACTICES].sort((a, b) => ORDER.indexOf(a.discipline) - ORDER.indexOf(b.discipline) || a.rung - b.rung);

export function practice(id: string): Practice | undefined {
  return LADDER.find((p) => p.id === id) ?? VARIANTS.find((p) => p.id === id);
}

/** The practice for a discipline and rung, using the track's variant when there is one. */
export function practiceAt(discipline: Practice["discipline"], rung: 1 | 2 | 3, track?: Track): Practice {
  return (track && VARIANTS.find((p) => p.discipline === discipline && p.rung === rung && p.tracks!.includes(track))) || LADDER.find((p) => p.discipline === discipline && p.rung === rung)!;
}

/** The whole ladder as a team on this track sees it. */
export function ladderFor(track?: Track): Practice[] {
  return LADDER.map((p) => practiceAt(p.discipline, p.rung, track));
}

/** Starting rung from a discipline's status: needs practice → 1, fair → 2, strong → 3. */
export function startingPractice(discipline: Practice["discipline"], status: Level, track?: Track): Practice {
  const rung = status === "strong" ? 3 : status === "fair" ? 2 : 1;
  return practiceAt(discipline, rung, track);
}

/** Next rung after `id` is done, or undefined at the top. */
export function nextPractice(id: string, track?: Track): Practice | undefined {
  const p = practice(id);
  return p && p.rung < 3 ? practiceAt(p.discipline, (p.rung + 1) as 2 | 3, track ?? p.tracks?.[0]) : undefined;
}

/** Among equally weak disciplines, the track decides which to start with. */
export function trackRank(track: Track | undefined, discipline: Practice["discipline"]): number {
  return track ? TRACKS[track].emphasis.indexOf(discipline) : 0;
}
