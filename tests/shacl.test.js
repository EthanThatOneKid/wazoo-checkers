import test from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadInitialPosition, loadPosition, deriveLegalMoves } from '../src/engine.js';
import { deriveLegalMovesShacl, validatePosition as validateShacl, loadShapesGraph } from '../src/shacl-engine.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => join(HERE, 'fixtures', name);

const key = (m) => `${m.from}|${m.to}|${m.isJump}`;

test('SHACL path derives the same legal move set as the SPARQL path', async () => {
  const a = await deriveLegalMoves(loadInitialPosition());
  const b = await deriveLegalMovesShacl(loadInitialPosition());
  assert.equal(a.length, b.length);
  assert.deepEqual([...a].map(key).sort(), [...b].map(key).sort());
});

test('SHACL path agrees with SPARQL path under forced capture', async () => {
  const a = await deriveLegalMoves(loadPosition(fixture('forced-capture.ttl')));
  const b = await deriveLegalMovesShacl(loadPosition(fixture('forced-capture.ttl')));
  assert.ok(a.every((m) => m.isJump), 'sparql path: jumps only');
  assert.ok(b.every((m) => m.isJump), 'shacl path: jumps only');
  assert.deepEqual([...a].map(key).sort(), [...b].map(key).sort());
});

test('SHACL shapes accept the initial position', async () => {
  const report = await validateShacl(loadInitialPosition(), loadShapesGraph());
  assert.equal(report.conforms, true);
});

test('SHACL shapes reject two pieces on one square', async () => {
  const store = loadPosition(fixture('double-occupancy.ttl'));
  const report = await validateShacl(store, loadShapesGraph());
  assert.equal(report.conforms, false);
  assert.ok(report.results.length > 0);
});

test('SHACL shapes reject an out-of-range square row', async () => {
  const store = loadPosition(fixture('bad-square.ttl'));
  const report = await validateShacl(store, loadShapesGraph());
  assert.equal(report.conforms, false);
});
