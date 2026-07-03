// Dependency-free Node checks for the pure (OpenCV-free) detection logic.
// Run with:  node test/logic-checks.mjs
// Exits non-zero on the first failed assertion.
import assert from 'node:assert/strict';
import { CONFIG } from '../js/config.js';

// --- Task 1: config keys present with expected starting values ---
const d = CONFIG.detection;
assert.equal(d.morphKernelSize, 3);
assert.deepEqual(d.expectedAspects, [1.39, 1.74]);
assert.equal(d.aspectTolerance, 0.15);
assert.equal(d.rectangularityFloor, 0.8);
assert.equal(d.reduceEpsilonSteps, 6);
assert.deepEqual(d.scoreWeights, { rect: 0.5, aspect: 0.3, area: 0.2 });

// --- Task 2: scoreCandidate ---
import { scoreCandidate } from '../js/rectDetector.js';

const goodClosed = {
  corners: [], area: 100, areaFraction: 0.4,
  rectangularity: 0.98, aspect: 1.39, convex: true,
};
{
  const r = scoreCandidate(goodClosed, CONFIG);
  assert.equal(r.pass, true, 'closed packet should pass');
  assert.ok(r.score > 0, 'passing candidate should score > 0');
  assert.equal(r.rejectReason, null);
}
// Opened packet (aspect 1.74) also passes via the second expected ratio.
assert.equal(scoreCandidate({ ...goodClosed, aspect: 1.74 }, CONFIG).pass, true);
// aspect 1.5 is nearer 1.39 (dist 0.11) than 1.74 (0.24); 0.11 <= 0.15 -> passes.
assert.equal(scoreCandidate({ ...goodClosed, aspect: 1.5 }, CONFIG).pass, true);
// Hard-gate rejections, each with its reason:
assert.equal(scoreCandidate({ ...goodClosed, aspect: 1.0 }, CONFIG).rejectReason, 'aspect');
assert.equal(scoreCandidate({ ...goodClosed, rectangularity: 0.5 }, CONFIG).rejectReason, 'rectangularity');
assert.equal(scoreCandidate({ ...goodClosed, areaFraction: 0.01 }, CONFIG).rejectReason, 'tooSmall');
assert.equal(scoreCandidate({ ...goodClosed, areaFraction: 0.99 }, CONFIG).rejectReason, 'tooLarge');
assert.equal(scoreCandidate({ ...goodClosed, convex: false }, CONFIG).rejectReason, 'notConvex');
// A higher-rectangularity candidate outscores a lower one, all else equal.
assert.ok(
  scoreCandidate(goodClosed, CONFIG).score >
  scoreCandidate({ ...goodClosed, rectangularity: 0.85 }, CONFIG).score
);

// --- Task 3: orderCorners ---
import { orderCorners } from '../js/rectDetector.js';

// Axis-aligned rectangle handed in scrambled -> canonical TL,TR,BR,BL.
{
  const tl = { x: 0, y: 0 }, tr = { x: 10, y: 0 }, br = { x: 10, y: 14 }, bl = { x: 0, y: 14 };
  assert.deepEqual(orderCorners([br, tl, bl, tr]), [tl, tr, br, bl]);
}
// Rotated quad (integer coords) still resolves correctly.
// Input scrambled; expected order is TL,TR,BR,BL.
assert.deepEqual(
  orderCorners([{ x: 9, y: 16 }, { x: 3, y: 0 }, { x: 0, y: 11 }, { x: 12, y: 5 }]),
  [{ x: 3, y: 0 }, { x: 12, y: 5 }, { x: 9, y: 16 }, { x: 0, y: 11 }]
);

console.log('logic checks passed');
