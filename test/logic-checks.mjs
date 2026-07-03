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

console.log('logic checks passed');
