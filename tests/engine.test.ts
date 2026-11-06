import assert from "node:assert";
import { describe, it } from "node:test";
import {
  loadInitialPosition,
  loadPositionFixture,
  deriveLegalMoves,
  clearDerivedMoves,
  applyMove,
  currentTurn,
} from "../src/engine.ts";
import { checkBoardIntegrity, deriveReachability } from "../src/reasoner-layer.ts";

const kingPredicate = () =>
  // structural NamedNode matches the store's term keys
  ({ termType: "NamedNode", value: "http://wazoo.dev/ontology/checkers#king" }) as never;

describe("SPARQL derivation (WazooSparqlEngine)", () => {
  it("initial position: red has exactly 7 legal simple moves", async () => {
    const store = loadInitialPosition();
    const moves = await deriveLegalMoves(store);
    assert.equal(moves.length, 7);
    assert.ok(moves.every((m) => !m.isJump));
    assert.ok(moves.every((m) => m.rule === "simple-move"));
  });

  it("forced capture: only jumps are legal, even though simple moves exist", async () => {
    const store = loadPositionFixture("forced-capture.ttl");
    const moves = await deriveLegalMoves(store);
    assert.ok(moves.length > 0);
    assert.ok(moves.every((m) => m.isJump));
    assert.equal(moves[0].captured, "http://wazoo.dev/ontology/checkers#pbA");
  });

  it("promotion: a red man reaching row 7 is crowned", async () => {
    const store = loadPositionFixture("promotion.ttl");
    const moves = await deriveLegalMoves(store);
    const move = moves.find((m) => m.to === "http://wazoo.dev/board/s7_1");
    assert.ok(move);
    applyMove(store, move);
    assert.equal(move.promoted, true);
    const kingQuads = store.getQuads(null, kingPredicate(), null);
    assert.ok(kingQuads.some((q) => q.object.value === "true"));
  });

  it("kings move backward: red king at s4_3 can reach row 3", async () => {
    const store = loadPositionFixture("king-backward.ttl");
    const moves = await deriveLegalMoves(store);
    const backs = moves.filter((m) => /\/s3_\d$/.test(m.to));
    assert.equal(backs.length, 2);
  });

  it("game over: black man at s0_0 has no legal moves", async () => {
    const store = loadPositionFixture("game-over.ttl");
    const moves = await deriveLegalMoves(store);
    assert.equal(moves.length, 0);
  });

  it("moves are cleared between turns so old derivations do not leak", async () => {
    const store = loadInitialPosition();
    const first = await deriveLegalMoves(store);
    applyMove(store, first[0]);
    clearDerivedMoves(store);
    const second = await deriveLegalMoves(store);
    assert.equal(currentTurn(store), "black");
    assert.ok(second.length > 0);
  });
});

describe("Reasoner layer (@wazoo/reasoner)", () => {
  it("board integrity: the initial position has no inconsistencies", () => {
    const store = loadInitialPosition();
    assert.deepEqual(checkBoardIntegrity(store.getQuads(null, null, null)), []);
  });

  it("board integrity: two pieces on one square is an inconsistency", () => {
    const store = loadPositionFixture("double-occupancy.ttl");
    const bad = checkBoardIntegrity(store.getQuads(null, null, null));
    assert.equal(bad.length, 1);
    assert.equal(bad[0].rule, "double-occupancy");
    assert.equal(new Set(bad[0].terms).size, 2);
  });

  it("reachability: the reasoner derives the transitive closure SPARQL cannot", async () => {
    const store = loadInitialPosition();
    await deriveLegalMoves(store); // also materializes ck:adjacent geometry
    const reach = deriveReachability(store.getQuads(null, null, null));
    assert.ok(reach.size > 0, "at least one piece must have reachability");
    for (const [, targets] of reach) {
      assert.ok(targets.length >= 1);
    }
    // Recursion check: some piece must reach squares beyond its adjacent ring.
    // A red man on row 0-2 has adjacent squares only in its own vicinity; the
    // transitive closure includes squares two or more steps away.
    const sample = [...reach.values()].find((t) => t.length >= 3);
    assert.ok(sample, "transitive closure must go beyond one ply");
  });
});
