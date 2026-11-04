import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MACHINES, byId } from '../data.js';
import { ridge, achievable } from '../roofline.js';

const within = (actual, expected, tol = 0.01) =>
  assert.ok(Math.abs(actual - expected) / expected <= tol,
    `${actual} is not within ${tol * 100}% of ${expected}`);

test('H100 ridge is about 295 flops per byte', () => {
  const r = ridge(byId.h100);
  console.log(`H100 ridge: ${r.toFixed(2)} flops/byte`);
  within(r, 295);
});

test('EPYC 9654 peak matches the arithmetic in data.js', () => {
  within(byId.epyc.peakFlops, 96 * 3.55e9 * 32);
  within(byId.epyc.bandwidth, 12 * 4800e6 * 8);
});

test('EPYC 9654 ridge is about 23.7 flops per byte', () => {
  const r = ridge(byId.epyc);
  console.log(`EPYC 9654 ridge: ${r.toFixed(2)} flops/byte`);
  within(r, 23.7);
});

test('the ridge moves by more than an order of magnitude', () => {
  assert.ok(ridge(byId.h100) / ridge(byId.epyc) > 10);
});

test('achievable is bandwidth-bound below the ridge and flat above it', () => {
  for (const m of MACHINES) {
    const r = ridge(m);
    within(achievable(m, r / 10), m.bandwidth * r / 10);
    assert.equal(achievable(m, r * 10), m.peakFlops);
    within(achievable(m, r), m.peakFlops);
  }
});

test('the machine list is frozen', () => {
  assert.ok(Object.isFrozen(MACHINES));
  assert.ok(MACHINES.every(Object.isFrozen));
});
