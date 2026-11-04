// Pure roofline arithmetic. No DOM, no state.
//
// A machine can do at most `peakFlops` operations per second, and can feed its
// arithmetic at most `bandwidth` bytes per second. "Arithmetic intensity" is how
// many operations the work does per byte it reads. Whichever limit you hit first
// is the one you get.

// The intensity (flops per byte) where the two limits meet. Below it, memory
// is the bottleneck; above it, arithmetic is.
export function ridge(machine) {
  return machine.peakFlops / machine.bandwidth;
}

// The best flops/s the machine can reach on work of the given intensity.
export function achievable(machine, intensity) {
  return Math.min(machine.peakFlops, machine.bandwidth * intensity);
}
