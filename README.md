# wazoo-checkers

Proof of concept built **only on the wazoo stack**: the board is an RDF graph
in a `@wazoo/sparql-engine` `MemoryStore`, every legal move is *derived* by
SPARQL `CONSTRUCT` rules at query time, and `@wazoo/reasoner` handles the two
things SPARQL 1.1 cannot — board integrity and recursive reachability.

```
positions/*.ttl    board state as triples (squares, pieces, turn)
rules/*.rq         the move rulebook, in SPARQL:
                     0-adjacency.rq      diagonal adjacency geometry
                     1-simple-move.rq    diagonal forward moves into empty squares
                     2-jump.rq           jumps over adjacent enemies (kings both ways)
                     3-forced-capture.rq when a jump exists, only jumps are legal
src/engine.ts      plumbing: load → derive → apply (WazooSparqlEngine)
src/reasoner-layer.ts  @wazoo/reasoner duties:
                       double-occupancy as an inconsistency rule,
                       reach-adjacent + reach-transitive = recursive Datalog
                       materializing the transitive closure (multi-ply
                       reachability, which SPARQL cannot express)
src/demo.ts        full random game: board, chosen move, provenance triple,
                   reasoner consistency + reachability per ply
```

Each derived move carries its own justification (`ck:rule`, `ck:because`), so
"why is this move legal" is a query, not a code read.

## Run it

Requires [Deno](https://deno.com). Packages come from JSR.

```sh
deno task demo   # full random game with provenance per ply
deno task test   # 9 tests: opening count, forced capture, promotion,
                 # king backward movement, game over, derivation hygiene,
                 # board integrity (clean + violated), recursive reachability
```

A 43-ply game runs in about 2.5 seconds end to end.

## What this demonstrates

- **Declarative rules over a fact graph**: adding a rule is adding a file, not
  editing an engine.
- **The division of labor**: SPARQL derives the one-ply move set (where its
  joins and filters shine); the reasoner derives the transitive closure and
  flags integrity violations (what SPARQL 1.1 cannot do — it cannot recurse
  over its own output). The reasoner's custom Datalog rules are evaluated
  semi-naively, so `reach-transitive` really does converge.
- **Non-monotonic state change** (capture removes a piece, promotion flips
  `ck:king`) by re-deriving from the fact graph each turn rather than
  accumulating inferences.
- **Auditable moves**: every ply prints the provenance triple and the
  reasoner's consistency verdict.

## Honest limits (the interesting part)

- Reachability is **geometric** (ignores occupancy beyond one ply) — Datalog
  over triple patterns has no negation, so "empty intermediate square" can't
  be a premise. One-ply legality stays in SPARQL where `NOT EXISTS` works.
- OWL 2 RL is monotonic by design: it materializes what the board *is*, not
  what happens next. State transitions stay re-derivation-based on purpose.
- Full chess lookahead is still search, not materialization — that part of
  the hybrid story stands.
