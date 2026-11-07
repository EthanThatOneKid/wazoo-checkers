// Reasoner layer: board reasoning on top of @wazoo/reasoner (OWL 2 RL +
// recursive Datalog-style custom rules). The SPARQL engine derives the one-
// ply move set; the reasoner does what SPARQL 1.1 cannot:
//
//   1. Board integrity: a custom rule reports any two pieces sharing a
//      square as an inconsistency.
//   2. Recursion: semi-naive evaluation materializes the transitive
//      canReach relation over SPARQL-derived adjacency — every square a
//      piece can reach in ANY number of diagonal steps, which plain SPARQL
//      cannot express (no recursion over its own output).
//
import { Reasoner, variables } from "@wazoo/reasoner";
import type { MemoryStore } from "@wazoo/sparql-engine";

const CK = "http://wazoo.dev/ontology/checkers#";
type RdfQuad = Parameters<MemoryStore["addQuad"]>[0];

const term = (v: string) => ({
  termType: "NamedNode",
  value: v,
  equals: (o: { value: string }) => o?.value === v,
}) as never;
const at = term(`${CK}at`);
const canReach = `${CK}canReach`;
const canReachTerm = term(canReach);
const adjacent = term(`${CK}adjacent`);

export type BoardInconsistency = { rule: string; terms: Array<string> };

export function buildBoardReasoner(): Reasoner {
  const { x, y, s, t } = variables();
  return new Reasoner({
    rules: [
      {
        name: "double-occupancy",
        body: [[x, at, s], [y, at, s]],
        inconsistent: [x, y],
      },
      {
        name: "reach-adjacent",
        body: [[x, at, s], [s, adjacent, t]],
        head: [[x, canReachTerm, t]],
      },
      {
        name: "reach-transitive",
        body: [[x, canReachTerm, s], [s, adjacent, t]],
        head: [[x, canReachTerm, t]],
      },
    ],
  } as never);
}

function boardReasoner(quads: Iterable<RdfQuad>): Reasoner {
  const reasoner = buildBoardReasoner();
  reasoner.add(quads as never);
  reasoner.run();
  return reasoner;
}

/** Run the reasoner over the board graph and return its inconsistencies. */
export function checkBoardIntegrity(quads: Iterable<RdfQuad>): Array<BoardInconsistency> {
  const reasoner = boardReasoner(quads);
  return reasoner
    .inconsistencies()
    .map((i) => ({
      rule: i.rule,
      terms: i.terms.map((t) => (t && "value" in t ? String(t.value) : String(t))),
    }))
    .filter((i) => new Set(i.terms).size > 1)
    // (x, y) and (y, x) both fire; one report per unordered pair.
    .filter((i, idx, all) =>
      all.findIndex((j) => j.rule === i.rule && [...j.terms].sort().join() === [...i.terms].sort().join()) ===
      idx
    );
}

/** All squares a piece can reach in any number of diagonal steps (transitive closure). */
export function deriveReachability(quads: Iterable<RdfQuad>): Map<string, Array<string>> {
  const reasoner = boardReasoner(quads);
  const out = new Map<string, Array<string>>();
  for (const quad of reasoner.closure("application")) {
    const q = quad as unknown as { subject: { value: string }; predicate: { value: string }; object: { value: string } };
    if (q.predicate.value !== canReach) continue;
    if (!out.has(q.subject.value)) out.set(q.subject.value, []);
    out.get(q.subject.value)!.push(q.object.value);
  }
  return out;
}
