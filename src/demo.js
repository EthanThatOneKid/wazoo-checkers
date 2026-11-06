// Plays a full game with random legal moves and prints each ply's board,
// the derived move with its provenance, and the final result.
import { loadInitialPosition, deriveLegalMoves, clearDerivedMoves, applyMove, currentTurn, renderBoard } from './engine.js';

const MAX_PLIES = 300;

const store = loadInitialPosition();
let prevMoves = [];
let ply = 0;
console.log('hello world game: RDF checkers, moves derived by SPARQL\n');
console.log(renderBoard(store));

for (ply = 1; ply <= MAX_PLIES; ply++) {
  clearDerivedMoves(store, prevMoves);
  const moves = await deriveLegalMoves(store);
  const turn = currentTurn(store);
  if (moves.length === 0) {
    const winner = turn === 'red' ? 'black' : 'red';
    console.log(`\nGame over: ${turn} has no legal moves. ${winner} wins after ${ply - 1} plies.`);
    break;
  }
  const move = moves[Math.floor(Math.random() * moves.length)];
  console.log(`\nPly ${ply} — ${turn} to move, ${moves.length} legal move(s), chosen: ${move.from} -> ${move.to}`);
  console.log(`  rule=${move.rule}${move.isJump ? ' (FORCED CAPTURE)' : ''}`);
  console.log(`  provenance: ${move.why}`);
  applyMove(store, move);
  if (move.promoted) console.log('  *** promotion: piece crowned at ' + move.to);
  prevMoves = moves;
  console.log(renderBoard(store));
}
