/**
 * "Split this change": when a change is too big to verify in one step, propose the smaller changes it could be,
 * in the order that keeps each one testable: the rule and its test, then the wiring, then the screen.
 * Tests travel with the code they test. Heuristic on paths only; the developer decides.
 */
import type { FileChange } from "./types";

export interface SplitStep {
  title: string;
  files: string[];
  lines: number;
}

const LAYERS: { title: string; rx: RegExp }[] = [
  { title: "Screen", rx: /(^|\/)(ui|components?|pages?|views?|screens?|frontend|web\/(?:pages|components))\/|\.(tsx|jsx|vue|svelte|css|scss|html)$/i },
  { title: "Wiring", rx: /(^|\/)(api|web|routes?|controllers?|handlers?|persistence|repositor(y|ies)|db|migrations?|adapters?|infra|server)\/|(controller|route|repo|handler|server)\.[jt]s$/i },
  { title: "Docs and config", rx: /\.(md|ya?ml|json|lock|toml|ini)$|(^|\/)(docs?|\.github)\//i },
];

const isTest = (p: string) => /\.(test|spec)\.[jt]sx?$|(^|\/)(__tests__|tests?)\//.test(p);
const stem = (p: string) => p.replace(/^.*\//, "").replace(/\.(test|spec)(?=\.)/, "").replace(/\.[^.]+$/, "");

export function splitPlan(files: FileChange[]): SplitStep[] {
  const groups = new Map<string, SplitStep>();
  const order = ["Rule and its tests", "Wiring", "Screen", "Docs and config"];
  for (const t of order) groups.set(t, { title: t, files: [], lines: 0 });
  const layerOf = (p: string) => LAYERS.find((l) => l.rx.test(p))?.title ?? "Rule and its tests";
  const codeLayer = new Map(files.filter((f) => !isTest(f.path)).map((f) => [stem(f.path), layerOf(f.path)]));
  for (const f of files) {
    const layer = isTest(f.path) ? codeLayer.get(stem(f.path)) ?? "Rule and its tests" : layerOf(f.path);
    const g = groups.get(layer)!;
    g.files.push(f.path);
    g.lines += f.addedLines.length;
  }
  return order.map((t) => groups.get(t)!).filter((g) => g.files.length);
}

export function splitPlanText(steps: SplitStep[]): string {
  return steps.map((s, i) => `${i + 1}. ${s.title}: ${s.files.length} file${s.files.length > 1 ? "s" : ""}, ${s.lines} lines (${s.files.slice(0, 3).map((f) => f.replace(/^.*\//, "")).join(", ")}${s.files.length > 3 ? ", …" : ""})`).join("\n");
}
