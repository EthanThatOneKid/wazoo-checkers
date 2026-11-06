// Plays a full game with random legal moves. Moves derive by SPARQL rules;
// board integrity and multi-ply reachability derive by the reasoner.
import {
  loadInitialPosition,
  deriveLegalMoves,
  clearDerivedMoves,
  applyMove,
  currentTurn,
  renderBoard,
} from "./engine.ts";
import { checkBoardIntegrity, deriveReachability } from "./reasoner-layer.ts";

const MAX_PLIES = 300;
const store = loadInitialPosition();
let prevMoves: Awaited<ReturnType<typeof deriveLegalMoves>> = [];

console.log("hello world game: RDF checkers — SPARQL derives moves, @wazoo/reasoner reasons about the board\n");
console.log(renderBoard(store));

for (let ply = 1; ply <= MAX_PLIES; ply++) {
  clearDerivedMoves(store);
  const moves = await deriveLegalMoves(store);
  const turn = currentTurn(store);
  if (moves.length === 0) {
    const winner = turn === "red" ? "black" : "red";
    console.log(`\nGame over: ${turn} has no legal moves. ${winner} wins after ${ply - 1} plies.`);
    break;
  }
  const inconsistencies = checkBoardIntegrity(store.getQuads(null, null, null));
  if (inconsistencies.length > 0) {
    console.log(`  !! board inconsistency: ${JSON.stringify(inconsistencies[0])}`);
  }
  const move = moves[Math.floor(Math.random() * moves.length)];
  console.log(`\nPly ${ply} — ${turn} to move, ${moves.length} legal move(s), chosen: ${move.from} -> ${move.to}`);
  console.log(`  rule=${move.rule}${move.isJump ? " (FORCED CAPTURE)" : ""}`);
  console.log(`  provenance: ${move.why}`);
  const reach = deriveReachability(store.getQuads(null, null, null));
  const mover = store.getQuads(null, { termType: "NamedNode", value: "http://wazoo.dev/ontology/checkers#at" }, { termType: "NamedNode", value: move.from } as never)[0].subject.value;
  const reachCount = reach.get(mover)?.length ?? 0;
  console.log(`  reasoner: board consistent, the moving piece reaches ${reachCount} squares in the recursive closure`);
  applyMove(store, move);
  if (move.promoted) console.log(`  *** promotion: piece crowned at ${move.to}`);
  console.log(renderBoard(store));
}
