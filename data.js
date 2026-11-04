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
