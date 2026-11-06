import test from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadInitialPosition, loadPosition, loadTurtle, deriveLegalMoves, clearDerivedMoves, applyMove, currentTurn } from '../src/engine.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => loadPosition(join(HERE, 'fixtures', name));

test('initial position: red has exactly 7 legal simple moves', async () => {
  const store = loadInitialPosition();
  const moves = await deriveLegalMoves(store);
  assert.equal(moves.length, 7);
  assert.ok(moves.every((m) => !m.isJump));
  assert.ok(moves.every((m) => m.rule === 'simple-move'));
});

test('forced capture: only jumps are legal, even though simple moves exist', async () => {
  const store = fixture('forced-capture.ttl');
  const moves = await deriveLegalMoves(store);
  assert.ok(moves.length > 0);
  assert.ok(moves.every((m) => m.isJump), 'every legal move must be a jump');
  const jump = moves[0];
  assert.equal(jump.captured, 'http://wazoo.dev/ontology/checkers#pbA');
  assert.match(jump.why, /jumps/);
});

test('promotion: a red man reaching row 7 is crowned', async () => {
  const store = fixture('promotion.ttl');
  const moves = await deriveLegalMoves(store);
  const move = moves.find((m) => m.to === 'http://wazoo.dev/board/s7_1');
  assert.ok(move, 'must have a move to s7_1');
  applyMove(store, move);
  assert.equal(move.promoted, true);
  const { DataFactory } = await import('n3');
  const king = store.getQuads(null, null, DataFactory.namedNode('http://wazoo.dev/board/s7_1'), null)
    .map((q) => q.subject)
    .filter((s) => store.getQuads(s, 'http://wazoo.dev/ontology/checkers#color', null, null).length > 0)
    .map((s) => store.getQuads(s, 'http://wazoo.dev/ontology/checkers#king', null, null)[0].object.value);
  assert.equal(king[0], 'true');
});

test('kings move backward: red king at s4_3 can reach row 3', async () => {
  const store = fixture('king-backward.ttl');
  const moves = await deriveLegalMoves(store);
  const backs = moves.filter((m) => /\/s3_\d$/.test(m.to));
  assert.equal(backs.length, 2, 'king must have both backward diagonals');
});

test('game over: black man at s0_0 has no legal moves', async () => {
  const store = fixture('game-over.ttl');
  const moves = await deriveLegalMoves(store);
  assert.equal(moves.length, 0);
});

test('moves are cleared between turns so old derivations do not leak', async () => {
  const store = loadInitialPosition();
  const first = await deriveLegalMoves(store);
  applyMove(store, first[0]);
  clearDerivedMoves(store, first);
  const second = await deriveLegalMoves(store);
  assert.equal(currentTurn(store), 'black');
  assert.ok(second.every((m) => !m.isJump || m.rule === 'jump'));
});
