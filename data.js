import { ridge, achievable } from './roofline.js';

// The machine specs: the single source of truth for every number on the page.
//
// Every machine is described by the same four numbers (lanes, peakFlops,
// bandwidth, and the precision peakFlops applies to). Every other number the
// page shows is computed from them, here or in the beats. Both rows are vendor
// specs; do not tune them to make the story nicer.
//
// AMD EPYC 9654 FP32 peak, written out so a reader can check it:
//     96 cores
//   x 3.55e9 cycles per second (all-core boost)
//   x 32 FP32 flops per core per cycle
//   = 10.9e12 flops per second
// The 32 is two FMA pipes x 8 FP32 lanes x 2 flops (one multiply plus one add).
// Zen 4 accepts 512-bit (16-lane) AVX-512 instructions but runs each one through
// those 256-bit pipes in two halves, so a 512-bit view gives the same answer:
// 2 x 16 lanes x 2 flops, every other cycle.
// Its memory is 12 channels of DDR5-4800: 12 x 4800e6 transfers/s x 8 bytes
// = 460.8e9 bytes/s. Ridge: 10.9e12 / 460.8e9 = about 23.7 flops per byte.
//
// NVIDIA H100 SXM: 989.4e12 bf16 flops/s on its tensor cores, dense (the
// spec-sheet figure of twice that assumes 2:4 sparsity), against 3.35e12 bytes/s
// of HBM3. Ridge: about 295 flops per byte.
export const MACHINES = Object.freeze([
  Object.freeze({
    id: 'epyc', name: 'AMD EPYC 9654', kind: 'cpu',
    lanes: 96,            // cores that can run independently
    peakFlops: 10.9e12,   // FP32 flops/s, see the arithmetic above
    bandwidth: 460.8e9,   // bytes/s, DDR5-4800 across 12 channels
    precision: 'FP32',
    note: '96 cores, 360 W',
  }),
  Object.freeze({
    id: 'h100', name: 'NVIDIA H100 SXM', kind: 'gpu',
    lanes: 16896,         // FP32 CUDA cores
    peakFlops: 989.4e12,  // bf16 dense tensor core flops/s
    bandwidth: 3.35e12,   // bytes/s, HBM3
    precision: 'bf16 dense',
    note: '16,896 CUDA cores, 700 W',
  }),
]);

export const byId = Object.freeze(Object.fromEntries(MACHINES.map((m) => [m.id, m])));

// ---------------------------------------------------------------------------
// Formatting, so every number on the page is written the same way.

const sig = (x, digits = 4) => Number(x.toPrecision(digits)).toLocaleString('en-US');
export const fmtCount = (x) => Math.round(x).toLocaleString('en-US');
export const fmtFlops = (x) => x >= 1e12 ? `${sig(x / 1e12)} TFLOP/s` : `${sig(x / 1e9)} GFLOP/s`;
export const fmtBytes = (x) => x >= 1e12 ? `${sig(x / 1e12)} TB/s` : `${sig(x / 1e9)} GB/s`;
export const fmtIntensity = (x) => x >= 100 ? fmtCount(x) : sig(x, 3);
export const fmtPercent = (x) => `${sig(x * 100, x < 0.01 ? 2 : 3)}%`;
export const fmtTimes = (x) => `${sig(x, x >= 10 ? 3 : 2)}×`;
export const fmtSeconds = (s) =>
  s >= 1 ? `${sig(s, 3)} s` : s >= 1e-3 ? `${sig(s * 1e3, 3)} ms`
  : s >= 1e-6 ? `${sig(s * 1e6, 3)} µs` : `${sig(s * 1e9, 3)} ns`;

// ---------------------------------------------------------------------------
// Stated assumptions. These are modeling choices, not vendor specs, and the
// page says so wherever it uses them.

export const ASSUME = Object.freeze({
  maxTasks: 100,          // beat 1 slider maximum
  cpuItemsPerTick: 2,     // beat 1: a CPU core clocks roughly twice as fast as a GPU lane
  smallMatrix: 8,         // beat 2: the 8x8 matrix the reader watches
  secondsPerMac: 1e-9,    // beat 2: one multiply-add per lane per nanosecond
  bigMatrix: 4096,        // beat 2: the scaled-up square matrix multiply
  modelParams: 70e9,      // beat 4: a 70-billion-parameter language model
});

// Beat 1: the total work is one item per GPU lane, so a single kind of task
// fills the GPU in one tick. The CPU's time never depends on how many kinds
// of task there are, because every core runs independently.
export const beat1Work = byId.h100.lanes;
export const beat1CpuTicks = Math.ceil(beat1Work / (byId.epyc.lanes * ASSUME.cpuItemsPerTick));

// ---------------------------------------------------------------------------
// Every number the prose shows. index.html carries these same strings as
// fallback text so the page reads correctly without JavaScript; the test
// checks that the two never drift apart, and beats.js rewrites them at boot.

const { h100, epyc } = byId;
const macs = ASSUME.bigMatrix ** 3;
const decodeBf16 = 1;   // flops per byte at batch 1: 2 flops per 2-byte weight
const decodeInt8 = 2;   // same 2 flops, but the weight is now 1 byte

export const FACTS = Object.freeze({
  'h100.lanes': fmtCount(h100.lanes),
  'h100.peak': fmtFlops(h100.peakFlops),
  'h100.sparse': fmtCount(2 * h100.peakFlops / 1e12),
  'h100.bandwidth': fmtBytes(h100.bandwidth),
  'h100.ridge': fmtIntensity(ridge(h100)),
  'epyc.lanes': fmtCount(epyc.lanes),
  'epyc.peak': fmtFlops(epyc.peakFlops),
  'epyc.bandwidth': fmtBytes(epyc.bandwidth),
  'epyc.ridge': fmtIntensity(ridge(epyc)),
  'ridge.ratio': fmtTimes(ridge(h100) / ridge(epyc)),
  'bandwidth.ratio': fmtTimes(h100.bandwidth / epyc.bandwidth),
  'beat1.work': fmtCount(beat1Work),
  'beat1.maxTasks': fmtCount(ASSUME.maxTasks),
  'beat1.cpuTicks': fmtCount(beat1CpuTicks),
  'beat1.cpuSpeed': fmtCount(ASSUME.cpuItemsPerTick),
  'beat2.size': fmtCount(ASSUME.smallMatrix),
  'beat2.cells': fmtCount(ASSUME.smallMatrix ** 2),
  'beat2.macs': fmtCount(ASSUME.smallMatrix ** 3),
  'beat2.serial': fmtSeconds(macs * ASSUME.secondsPerMac),
  'beat2.parallel': fmtSeconds(macs * ASSUME.secondsPerMac / h100.lanes),
  'beat2.bigMatrix': fmtCount(ASSUME.bigMatrix),
  'mm.share': fmtPercent(achievable(h100, 100) / h100.peakFlops),
  'decode.flops': fmtFlops(achievable(h100, decodeBf16)),
  'decode.share': fmtPercent(achievable(h100, decodeBf16) / h100.peakFlops),
  'decode.int8': fmtFlops(achievable(h100, decodeInt8)),
  'decode.params': `${fmtCount(ASSUME.modelParams / 1e9)} billion`,
  'decode.gbBf16': fmtCount(ASSUME.modelParams * 2 / 1e9),
  'decode.gbInt8': fmtCount(ASSUME.modelParams / 1e9),
  'decode.tokBf16': fmtCount(h100.bandwidth / (ASSUME.modelParams * 2)),
  'decode.tokInt8': fmtCount(h100.bandwidth / ASSUME.modelParams),
  'decode.batch': fmtCount(ridge(h100) / decodeBf16),
});
