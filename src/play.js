// Interactive play: prints derived moves, you type a number.
import readline from 'readline/promises';
import { loadInitialPosition, deriveLegalMoves, clearDerivedMoves, applyMove, currentTurn, renderBoard } from './engine.js';

const store = loadInitialPosition();
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
let prevMoves = [];

console.log('hello world interactive game: RDF checkers, moves derived by SPARQL\n');
console.log(renderBoard(store));

for (let ply = 1; ply <= 300; ply++) {
  clearDerivedMoves(store, prevMoves);
  const moves = await deriveLegalMoves(store);
  const turn = currentTurn(store);
  if (moves.length === 0) {
    console.log(`\nGame over: ${turn} has no legal moves. ${turn === 'red' ? 'black' : 'red'} wins.`);
    break;
  }
  console.log(`\nPly ${ply} — ${turn} to move. Legal moves:`);
  moves.forEach((m, i) =>
    console.log(`  ${i + 1}. ${m.from} -> ${m.to}   [${m.rule}${m.isJump ? ', forced capture' : ''}] ${m.why}`),
  );
  const answer = await rl.question('\nMove number (or q): ');
  if (answer.trim() === 'q') break;
  const idx = Number(answer.trim()) - 1;
  if (!Number.isInteger(idx) || idx < 0 || idx >= moves.length) {
    console.log('Not a valid move number.'); ply--; continue;
  }
  applyMove(store, moves[idx]);
  prevMoves = moves;
  console.log(renderBoard(store));
}
rl.close();
