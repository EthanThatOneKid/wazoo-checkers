# wazoo-checkers

Proof of concept: **checkers with no hand-written move logic.** The board is an
RDF graph, and every legal move — including forced captures — is *derived* by
SPARQL `CONSTRUCT` rules at query time. The TypeScript/JS engine is only
plumbing: it loads triples, runs the rules, and applies the chosen move.

```
positions/*.ttl   board state as triples (squares, pieces, turn)
rules/*.rq        the entire rulebook, in SPARQL:
                    1-simple-move.rq    diagonal forward moves into empty squares
                    2-jump.rq           jumps over adjacent enemies (kings both ways)
                    3-forced-capture.rq when a jump exists, only jumps are legal
src/engine.js     plumbing: load → derive → apply
src/demo.js       plays a full random game, printing each ply's board,
                  chosen move, and the provenance triple that justified it
src/play.js       interactive play
```

Each derived move carries its own justification (`ck:rule`, `ck:because`), so
"why is this move legal" is a query, not a code read.

## Run it

```sh
npm install
npm run demo   # full random game with provenance per ply
npm test       # 6 tests: opening count, forced capture, promotion,
               # king backward movement, game over, derivation hygiene
```

## What this demonstrates

- **Declarative rules over a fact graph**: adding a rule is adding a file, not
  editing an engine.
- **Non-monotonic state change** (capture removes a piece, promotion flips
  `ck:king`) — the thing RDF reasoning is often said not to do, done by
  re-deriving from the fact graph each turn rather than accumulating inferences.
- **Auditable moves**: every ply prints the provenance triple.

## Honest limits (the interesting part)

- SPARQL 1.1 can't recurse over its own output, so **multi-jump chains and
  lookahead beyond one ply don't derive in a single query**. One ply per turn
  is where the approach pays off; deeper search belongs in a real engine
  (the hybrid model). A fun follow-up: materialize derived positions back into
  the graph and iterate — "breadth-first search, one CONSTRUCT at a time."
- Derivation takes ~240ms per turn (Comunica, in-memory store). Fine for a
  demo, slow for a game.

## Related

Built as a demo for wazoo.dev — a knowledge graph where facts go in and
verifiable answers come out.
