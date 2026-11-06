// Second derivation path: SHACL.
//
// 1. Validate the position against shacl/checkers-shapes.ttl (structural
//    legality: piece/turn/occupancy shapes).
// 2. Execute the sh:SPARQLConstructRule rules declared in the shapes graph
//    (simple move, jump) via Comunica.
// 3. Run the forced-capture legality check as a SHACL SPARQL constraint and
//    keep only the moves that satisfy it.
//
// The shapes graph is the single source of truth for both validation and
// rules; nothing here duplicates rule logic.
import shaclValidator from 'rdf-validate-shacl';
import { default as validatorEnv } from 'rdf-validate-shacl/src/defaultEnv.js';
const Validator = shaclValidator;
import { Parser, Store, DataFactory } from 'n3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { CK } from './engine.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHACL = 'http://www.w3.org/ns/shacl#';

function parseTurtle(text, baseIRI) {
  return new Parser({ baseIRI }).parse(text);
}

export function loadShapesGraph() {
  const store = new Store({ maxDataChangedListeners: 0 });
  for (const q of parseTurtle(readFileSync(join(ROOT, 'shacl', 'checkers-shapes.ttl'), 'utf8'))) store.addQuad(q);
  return store;
}

export async function validatePosition(store, shapesGraph = loadShapesGraph()) {
  // rdf-validate-shacl expects a clownface-enabled RDF environment.
  const factory = validatorEnv;
  const validator = new Validator(shapesGraph, { factory });
  const dataset = factory.dataset([...store]);
  return validator.validate(dataset);
}

async function comunica() {
  const { QueryEngine } = await import('@comunica/query-sparql');
  return new QueryEngine();
}

export async function deriveLegalMovesShacl(store) {
  const shapesGraph = loadShapesGraph();
  const report = await validatePosition(store, shapesGraph);
  if (!report.conforms) {
    const msgs = report.results.map((r) => `${r.sourceShape?.value ?? ''}: ${r.message?.join('; ') ?? 'violation'}`);
    throw new Error(`position violates SHACL shapes: ${msgs.join(' | ')}`);
  }

  // Execute every SPARQL construct rule in the shapes graph.
  const ruleShapes = shapesGraph.getQuads(null, `${SHACL}rule`, null, null);
  for (const ruleShape of ruleShapes) {
    const ruleNode = ruleShape.object;
    const construct = shapesGraph.getQuads(ruleNode, `${SHACL}construct`, null, null)[0];
    if (!construct) continue;
    const sparql = construct.object.value.replace(/\\"/g, '"');
    const engine = await comunica();
    const it = await engine.queryQuads(sparql, { sources: [store] });
    for await (const q of it) store.addQuad(q);
  }

  // Legality: run the LegalityShape SPARQL constraint to find moves whose
  // legality annotation is wrong, and fix them in place.
  const legality = shapesGraph.getQuads(null, `${CK}query`, null, null)
    .filter((q) => q.object.value.includes('forceCapture'))[0];
  if (!legality) throw new Error('no legality constraint in shapes graph');
  const engine = await comunica();
  const it = await engine.queryBindings(legality.object.value.replace(/\\"/g, '"'), { sources: [store] });
  for await (const b of it) {
    const move = b.get('this');
    const ok = b.get('ok').value === 'true';
    const isJumpQuad = store.getQuads(move, `${CK}isJump`, null, null)[0];
    store.removeQuads(store.getQuads(move, `${CK}legal`, null, null));
    store.addQuad(move, `${CK}legal`, DataFactory.literal(ok));
  }

  const bindings = await engine.queryBindings(
    `PREFIX ck: <${CK}>
     SELECT DISTINCT ?move ?from ?to ?isJump ?rule ?why ?captures ?legal WHERE {
       ?move a ck:Move ; ck:from ?from ; ck:to ?to ; ck:isJump ?isJump ;
             ck:rule ?rule ; ck:because ?why .
       OPTIONAL { ?move ck:captures ?captures . }
       OPTIONAL { ?move ck:legal ?legal . }
       FILTER(!BOUND(?legal) || ?legal = true)
     } ORDER BY ?from ?to`,
    { sources: [store] },
  );
  const out = [];
  for await (const b of bindings) {
    const legal = b.get('legal')?.value;
    out.push({
      iri: b.get('move').value,
      from: b.get('from').value,
      to: b.get('to').value,
      isJump: b.get('isJump').value === 'true',
      rule: b.get('rule').value,
      why: b.get('why').value,
      captured: b.get('captures')?.value,
      conformed: legal !== 'false',
    });
  }
  return out;
}
