// Core engine: load a position, derive legal moves with SPARQL rules,
// apply a move, detect promotion and game over. All rule knowledge lives
// in rules/*.rq; this file is only plumbing.
import { QueryEngine } from '@comunica/query-sparql';
import { Store, Parser, DataFactory } from 'n3';
const { literal } = DataFactory;
import { readFileSync, readdirSync } from 'fs';

async function collect(stream) {
  const out = [];
  for await (const item of stream) out.push(item);
  return out;
}
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

export const CK = 'http://wazoo.dev/ontology/checkers#';
export const BOARD = 'http://wazoo.dev/board/';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const rdf = (local) => `${CK}${local}`;

export function loadTurtle(paths) {
  const parser = new Parser();
  const store = new Store({ maxDataChangedListeners: 0 });
  for (const p of paths) {
    for (const quad of parser.parse(readFileSync(p, 'utf8'))) store.addQuad(quad);
  }
  return store;
}

export function loadInitialPosition(extraPaths = []) {
  return loadTurtle([
    join(ROOT, 'ontology', 'checkers.ttl'),
    join(ROOT, 'positions', 'squares.ttl'),
    join(ROOT, 'positions', 'initial.ttl'),
    ...extraPaths,
  ]);
}

export function loadPosition(fixturePath) {
  return loadTurtle([
    join(ROOT, 'ontology', 'checkers.ttl'),
    join(ROOT, 'positions', 'squares.ttl'),
    fixturePath,
  ]);
}

export async function readRules() {
  const dir = join(ROOT, 'rules');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.rq'))
    .sort()
    .map((f) => ({ name: f, sparql: readFileSync(join(dir, f), 'utf8') }));
}

const engine = new QueryEngine();

async function runConstruct(store, sparql) {
  const stream = await engine.queryQuads(sparql, { sources: [store] });
  return collect(stream);
}

export async function deriveLegalMoves(store) {
  // Sweep ALL move quads (legal or not) from the previous turn before
  // re-deriving, so stale derivations can never leak into this turn.
  const stale = store.getQuads(null, 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type', `${CK}Move`, null)
    .map((q) => q.subject);
  for (const s of stale) store.removeQuads(store.getQuads(s, null, null, null));
  for (const { name, sparql } of await readRules()) {
    const quads = await runConstruct(store, sparql);
    for (const q of quads) store.addQuad(q);
  }
  // Remove derived move quads from previous turns: any triple whose subject
  // is a move IRI. Derived this turn must stay, so snapshot IRIs first.
  const moves = [];
  const bindings = await collect(
    await engine.queryBindings(
      `PREFIX ck: <${CK}>
       SELECT DISTINCT ?move ?from ?to ?isJump ?rule ?why ?captures WHERE {
         ?move a ck:Move ; ck:from ?from ; ck:to ?to ; ck:isJump ?isJump ;
               ck:rule ?rule ; ck:because ?why ; ck:legal true .
         OPTIONAL { ?move ck:captures ?captures . }
       } ORDER BY ?from ?to`,
      { sources: [store] },
    ),
  );
  for (const b of bindings) {
    moves.push({
      iri: b.get('move').value,
      from: b.get('from').value,
      to: b.get('to').value,
      isJump: b.get('isJump').value === 'true',
      rule: b.get('rule').value,
      why: b.get('why').value,
      captured: b.get('captures')?.value,
    });
  }
  return moves;
}

export function clearDerivedMoves(store, moves) {
  for (const m of moves) store.removeQuads(store.getQuads(m.iri, null, null, null));
}

export function currentTurn(store) {
  const turn = store.getQuads(`${BOARD}game`, rdf('turn'), null, null)[0];
  return turn.object.value;
}

export function applyMove(store, move) {
  const turn = currentTurn(store);
  const from = move.from, to = move.to;
  const lit = (v) => literal(v);
  // The moving piece: the one of the turn color sitting on ?from.
  const pieces = store.getQuads(null, rdf('at'), from, null)
    .map((q) => q.subject)
    .filter((s) => store.getQuads(s, rdf('color'), lit(turn), null).length > 0);
  if (pieces.length !== 1) throw new Error(`expected exactly one ${turn} piece on ${from}, got ${pieces.length}`);
  const piece = pieces[0];
  store.removeQuads(store.getQuads(piece, rdf('at'), from, null));
  store.addQuad(piece, rdf('at'), to);
  // Remove the captured piece entirely.
  if (move.isJump) {
    const captured = store.getQuads(null, rdf('at'), move.captured, null).map((q) => q.subject);
    for (const victim of captured) store.removeQuads(store.getQuads(victim, null, null, null));
  }
  // Promotion: red man reaching row 7, black man reaching row 0.
  const row = Number(store.getQuads(to, rdf('row'), null, null)[0].object.value);
  const isKing = store.getQuads(piece, rdf('king'), null, null)[0].object.value === 'true';
  if (!isKing && ((turn === 'red' && row === 7) || (turn === 'black' && row === 0))) {
    store.removeQuads(store.getQuads(piece, rdf('king'), null, null));
    store.addQuad(piece, rdf('king'), literal(true));
    move.promoted = true;
  }
  store.removeQuads(store.getQuads(`${BOARD}game`, rdf('turn'), null, null));
  store.addQuad(`${BOARD}game`, rdf('turn'), lit(turn === 'red' ? 'black' : 'red'));
}

export function renderBoard(store) {
  const at = {};
  for (const q of store.getQuads(null, rdf('at'), null, null)) {
    at[q.object.value] = {
      color: store.getQuads(q.subject, rdf('color'), null, null)[0].object.value,
      king: store.getQuads(q.subject, rdf('king'), null, null)[0].object.value === 'true',
    };
  }
  const lines = ['    c0 c1 c2 c3 c4 c5 c6 c7'];
  for (let r = 7; r >= 0; r--) {
    let row = `r${r}  `;
    for (let c = 0; c <= 7; c++) {
      const p = at[`${BOARD}s${r}_${c}`];
      row += p ? (p.color === 'red' ? (p.king ? ' R ' : ' r ') : p.king ? ' B ' : ' b ') : ' . ';
    }
    lines.push(row);
  }
  return lines.join('\n');
}
