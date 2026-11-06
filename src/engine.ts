// Core engine: the board is an RDF graph in a @wazoo/sparql-engine
// MemoryStore; every legal move is derived by SPARQL CONSTRUCT rules.
// This file is only plumbing: load, derive, apply.
import { WazooSparqlEngine, MemoryStore, DataFactory, parseTurtleQuads } from "@wazoo/sparql-engine";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

export const CK = "http://wazoo.dev/ontology/checkers#";
export const BOARD = "http://wazoo.dev/board/";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const df = DataFactory;
const rdfType = df.namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
const MoveNode = df.namedNode(`${CK}Move`);
const at = df.namedNode(`${CK}at`);
const color = df.namedNode(`${CK}color`);
const king = df.namedNode(`${CK}king`);
const row = df.namedNode(`${CK}row`);
const turn = df.namedNode(`${CK}turn`);
const captures = df.namedNode(`${CK}captures`);

export type LegalMove = {
  iri: string;
  from: string;
  to: string;
  isJump: boolean;
  rule: string;
  why: string;
  captured?: string;
  promoted?: boolean;
};

type RdfQuad = Parameters<MemoryStore["addQuad"]>[0];

export function loadPositionFiles(paths: Array<string>): MemoryStore {
  const quads = paths.flatMap((p) => parseTurtleQuads(readFileSync(p, "utf8")));
  return new MemoryStore(quads);
}

export function loadInitialPosition(extraPaths: Array<string> = []): MemoryStore {
  return loadPositionFiles([
    join(ROOT, "ontology", "checkers.ttl"),
    join(ROOT, "positions", "squares.ttl"),
    join(ROOT, "positions", "initial.ttl"),
    ...extraPaths,
  ]);
}

export function loadPositionFixture(name: string): MemoryStore {
  return loadPositionFiles([
    join(ROOT, "ontology", "checkers.ttl"),
    join(ROOT, "positions", "squares.ttl"),
    join(ROOT, "tests", "fixtures", name),
  ]);
}

function readRules(): Array<{ name: string; sparql: string }> {
  const dir = join(ROOT, "rules");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".rq"))
    .sort()
    .map((f) => ({ name: f, sparql: readFileSync(join(dir, f), "utf8") }));
}

function engineFor(store: MemoryStore): WazooSparqlEngine {
  return new WazooSparqlEngine({ store });
}

/** Sweep all derived move quads before re-deriving, so stale moves never leak. */
export function clearDerivedMoves(store: MemoryStore): void {
  for (const q of store.getQuads(null, rdfType, MoveNode)) {
    for (const stale of store.getQuads(q.subject, null, null)) {
      store.removeQuad(stale);
    }
  }
}

async function runConstruct(store: MemoryStore, sparql: string): Promise<void> {
  const engine = engineFor(store);
  const res = await engine.execute({ query: sparql });
  if (res.kind !== "construct") throw new Error(`expected construct result, got ${res.kind}`);
  for (const q of res.data.quads) store.addQuad(q);
}

export async function deriveLegalMoves(store: MemoryStore): Promise<Array<LegalMove>> {
  clearDerivedMoves(store);
  for (const { name, sparql } of readRules()) {
    await runConstruct(store, sparql);
  }
  const engine = engineFor(store);
  const res = await engine.execute({
    query: `PREFIX ck: <${CK}>
       SELECT DISTINCT ?move ?from ?to ?isJump ?rule ?why ?captures WHERE {
         ?move a ck:Move ; ck:from ?from ; ck:to ?to ; ck:isJump ?isJump ;
               ck:rule ?rule ; ck:because ?why ; ck:legal true .
         OPTIONAL { ?move ck:captures ?captures . }
       } ORDER BY ?from ?to`,
  });
  if (res.kind !== "select") throw new Error(`expected select result, got ${res.kind}`);
  const bindings = res.data.results.bindings;
  return bindings.map((b) => ({
    iri: String(b.move.value),
    from: String(b.from.value),
    to: String(b.to.value),
    isJump: b.isJump.value === "true",
    rule: String(b.rule.value),
    why: String(b.why.value),
    captured: b.captures ? String(b.captures.value) : undefined,
  }));
}

export function currentTurn(store: MemoryStore): string {
  const q = store.getQuads(df.namedNode(`${BOARD}game`), turn, null)[0];
  return q.object.value;
}

export function applyMove(store: MemoryStore, move: LegalMove): void {
  const turnValue = currentTurn(store);
  // The moving piece: the one of the turn color sitting on ?from.
  const pieces = store.getQuads(null, at, df.namedNode(move.from))
    .map((q) => q.subject)
    .filter((s) => store.getQuads(s, color, df.literal(turnValue)).length > 0);
  if (pieces.length !== 1) {
    throw new Error(`expected exactly one ${turnValue} piece on ${move.from}, got ${pieces.length}`);
  }
  const piece = pieces[0];
  for (const q of store.getQuads(piece, at, df.namedNode(move.from))) store.removeQuad(q);
  store.addQuad(piece, at, df.namedNode(move.to));
  // Remove the captured piece entirely.
  if (move.isJump) {
    if (!move.captured) throw new Error("jump move without a captured piece");
    for (const q of store.getQuads(df.namedNode(move.captured), null, null)) store.removeQuad(q);
  }
  // Promotion: red man reaching row 7, black man reaching row 0.
  const rowQ = store.getQuads(df.namedNode(move.to), row, null)[0];
  const rowValue = Number(rowQ.object.value);
  const isKing = store.getQuads(piece, king, null)[0].object.value === "true";
  if (
    !isKing &&
    ((turnValue === "red" && rowValue === 7) || (turnValue === "black" && rowValue === 0))
  ) {
    for (const q of store.getQuads(piece, king, null)) store.removeQuad(q);
    store.addQuad(piece, king, df.literal("true", df.namedNode("http://www.w3.org/2001/XMLSchema#boolean")));
    move.promoted = true;
  }
  for (const q of store.getQuads(df.namedNode(`${BOARD}game`), turn, null)) store.removeQuad(q);
  store.addQuad(
    df.namedNode(`${BOARD}game`),
    turn,
    df.literal(turnValue === "red" ? "black" : "red"),
  );
}

export function renderBoard(store: MemoryStore): string {
  const at_: Record<string, { color: string; king: boolean }> = {};
  for (const q of store.getQuads(null, at, null)) {
    const colorQ = store.getQuads(q.subject, color, null)[0];
    const kingQ = store.getQuads(q.subject, king, null)[0];
    at_[q.object.value] = { color: colorQ.object.value, king: kingQ.object.value === "true" };
  }
  const lines = ["    c0 c1 c2 c3 c4 c5 c6 c7"];
  for (let r = 7; r >= 0; r--) {
    let rowStr = `r${r}  `;
    for (let c = 0; c <= 7; c++) {
      const p = at_[`${BOARD}s${r}_${c}`];
      rowStr += p ? (p.color === "red" ? (p.king ? " R " : " r ") : p.king ? " B " : " b ") : " . ";
    }
    lines.push(rowStr);
  }
  return lines.join("\n");
}
