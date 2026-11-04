// The interactive beats. Each exported function takes its <section>, and owns
// its own state, canvas, and input handling. No beat touches another's state.
// All numbers come from data.js; the prose numbers are already in index.html.

import {
  MACHINES, byId, ASSUME, beat1Work, beat1CpuTicks,
  fmtCount, fmtFlops, fmtBytes, fmtIntensity, fmtPercent, fmtSeconds, fmtTimes,
} from './data.js';
import { ridge, achievable } from './roofline.js';

// ---------------------------------------------------------------------------
// Shared helpers

const motion = matchMedia('(prefers-reduced-motion: reduce)');
export const prefersReducedMotion = () => motion.matches;

const scheme = matchMedia('(prefers-color-scheme: dark)');
const color = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

// Keep a canvas sharp at its CSS size, and repaint it when it resizes or the
// color scheme flips. Returns the paint function for state changes.
function redrawOn(canvas, draw) {
  const paint = () => {
    const { width, height } = canvas.getBoundingClientRect();
    if (!width || !height) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, width, height);
  };
  new ResizeObserver(paint).observe(canvas);
  scheme.addEventListener('change', paint);
  return paint;
}

// A rounded label with a background, so it reads on top of anything.
function pill(ctx, text, x, y, { bg, fg, size = 13 }) {
  ctx.font = `600 ${size}px ${FONT}`;
  const w = ctx.measureText(text).width + 16, h = size + 12;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, 6);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

const plural = (n, word) => `${fmtCount(n)} ${word}${n === 1 ? '' : 's'}`;

// ---------------------------------------------------------------------------
// Beat 1: the same work, split into more and more different kinds.

export function beat1(section) {
  const cpu = byId.epyc, gpu = byId.h100;
  const COLS = 132; // H100 lanes are drawn as 132 columns (one per multiprocessor)
  const rows = Math.ceil(gpu.lanes / COLS);
  const maxTicks = Math.max(beat1CpuTicks, ASSUME.maxTasks);

  const slider = section.querySelector('#tasks');
  const out = section.querySelector('#tasks-out');
  const canvas = section.querySelector('.gpu-canvas');
  const gpuDesc = section.querySelector('#gpu-desc');
  const cpuNote = section.querySelector('#cpu-note');
  const bars = {
    cpu: section.querySelector('#cpu-bar'), gpu: section.querySelector('#gpu-bar'),
    cpuTicks: section.querySelector('#cpu-ticks'), gpuTicks: section.querySelector('#gpu-ticks'),
  };
  const verdict = section.querySelector('#race-verdict');

  slider.max = ASSUME.maxTasks;
  section.querySelector('.cpu-grid').append(
    ...Array.from({ length: cpu.lanes }, () => document.createElement('span')));

  let tasks = Number(slider.value);

  // The GPU runs one kind of work per tick; the biggest kind sets how many
  // lanes are busy, and every other lane waits.
  const busyLanes = () => Math.min(gpu.lanes, Math.ceil(beat1Work / tasks));

  const paint = redrawOn(canvas, (ctx, w, h) => {
    const busy = busyLanes();
    const cw = w / COLS, ch = h / rows, gap = cw > 3 ? 0.6 : 0;
    const busyColor = color('--busy'), idleColor = color('--idle');
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < gpu.lanes; i++) {
      ctx.fillStyle = i < busy ? busyColor : idleColor;
      ctx.fillRect((i % COLS) * cw, Math.floor(i / COLS) * ch, cw - gap, ch - gap);
    }
    const idle = gpu.lanes - busy;
    const label = idle === 0
      ? `all ${fmtCount(gpu.lanes)} lanes busy`
      : `${fmtCount(idle)} lanes idle (${fmtPercent(idle / gpu.lanes)})`;
    const busyRows = Math.ceil(busy / COLS);
    const y = idle === 0 ? h / 2 : (busyRows * ch + h) / 2;
    pill(ctx, label, w / 2, y, { bg: color('--surface'), fg: color('--ink'), size: w < 300 ? 12 : 14 });
  });

  function update() {
    const busy = busyLanes(), idle = gpu.lanes - busy;
    out.value = out.textContent = fmtCount(tasks);
    slider.setAttribute('aria-valuetext', `${tasks} different ${tasks === 1 ? 'kind' : 'kinds'} of work`);
    gpuDesc.innerHTML = `Each tick: <strong>${fmtCount(busy)}</strong> lanes have work, `
      + `<strong>${fmtCount(idle)}</strong> sit idle. It takes ${plural(tasks, 'tick')}, one per kind of work.`;
    cpuNote.innerHTML = `All <strong>${fmtCount(cpu.lanes)}</strong> cores busy, each on its own task. `
      + `It takes ${plural(beat1CpuTicks, 'tick')} however the work is split.`;
    bars.cpu.style.width = `${(100 * beat1CpuTicks) / maxTicks}%`;
    bars.gpu.style.width = `${(100 * tasks) / maxTicks}%`;
    bars.cpuTicks.textContent = plural(beat1CpuTicks, 'tick');
    bars.gpuTicks.textContent = plural(tasks, 'tick');
    verdict.textContent = tasks < beat1CpuTicks
      ? `GPU finishes ${fmtTimes(beat1CpuTicks / tasks)} sooner.`
      : tasks === beat1CpuTicks
        ? 'A tie: the GPU’s idle lanes have cancelled out its size.'
        : `CPU finishes first. Most of the GPU’s lanes spend every tick waiting.`;
    paint();
  }

  slider.addEventListener('input', () => { tasks = Number(slider.value); update(); });
  update();
}

// ---------------------------------------------------------------------------
// Beat 2: an 8x8 matrix multiply, one cell at a time or all at once.

export function beat2(section) {
  const n = ASSUME.smallMatrix, cellCount = n * n;
  const SERIAL_MS = 1500, FLASH_MS = 300;
  const matrix = section.querySelector('.matrix');
  const order = section.querySelector('#mm-order');
  const time = section.querySelector('#mm-time');
  const desc = section.querySelector('#matmul-desc');
  const buttons = [...section.querySelectorAll('button[data-mode]')];
  const cells = Array.from({ length: cellCount }, () => document.createElement('span'));
  matrix.append(...cells);

  // Each cell is n multiply-adds. One lane does them all in sequence; with one
  // lane per cell, every cell runs at once and the time is a single cell's.
  const serialSeconds = cellCount * n * ASSUME.secondsPerMac;
  const parallelSeconds = n * ASSUME.secondsPerMac;

  let frame = 0, timer = 0;

  function show(done, current, seconds, note) {
    cells.forEach((c, i) => {
      c.classList.toggle('done', i < done);
      c.classList.toggle('now', current(i));
    });
    order.textContent = `${fmtCount(done)} of ${fmtCount(cellCount)}`;
    time.textContent = seconds === null ? '–' : `${fmtSeconds(seconds)} ${note}`;
    desc.textContent = `A ${n} by ${n} grid of answer cells. ${fmtCount(done)} of ${fmtCount(cellCount)} computed;`
      + ' none needed another cell’s answer.' + (seconds === null ? '' : ` Modeled time ${fmtSeconds(seconds)} ${note}.`);
  }

  function stop() { cancelAnimationFrame(frame); clearTimeout(timer); }

  function runSerial() {
    const note = '(one lane)';
    if (prefersReducedMotion()) return show(cellCount, () => false, serialSeconds, note);
    const start = performance.now();
    const step = (now) => {
      const done = Math.min(cellCount, Math.floor(((now - start) / SERIAL_MS) * cellCount));
      show(done, (i) => i === done, done * n * ASSUME.secondsPerMac, note);
      if (done < cellCount) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  }

  function runParallel() {
    const note = `(${fmtCount(cellCount)} lanes, one per cell)`;
    if (prefersReducedMotion()) return show(cellCount, () => false, parallelSeconds, note);
    show(0, () => true, null);
    timer = setTimeout(() => show(cellCount, () => false, parallelSeconds, note), FLASH_MS);
  }

  for (const b of buttons) {
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => {
      stop();
      buttons.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      (b.dataset.mode === 'serial' ? runSerial : runParallel)();
    });
  }
  show(0, () => false, null);
}

// ---------------------------------------------------------------------------
// Beat 3: the roofline, to scale.

export function beat3(section) {
  const X = [0.1, 1e4];        // flops per byte
  const Y = [1e10, 3e15];      // flops per second
  const toIntensity = (v) => 10 ** (Math.log10(X[0]) + (v / 1000) * Math.log10(X[1] / X[0]));
  const toSlider = (i) => Math.round((1000 * Math.log10(i / X[0])) / Math.log10(X[1] / X[0]));

  const canvas = section.querySelector('.roofline-canvas');
  const slider = section.querySelector('#intensity');
  const out = section.querySelector('#intensity-out');
  const verdict = section.querySelector('#roofline-verdict');
  const desc = section.querySelector('#roofline-desc');
  const machineButtons = [...section.querySelectorAll('button[data-machine]')];
  const presets = [...section.querySelectorAll('button[data-intensity]')];

  let machine = byId.h100;
  let intensity = toIntensity(Number(slider.value));

  const paint = redrawOn(canvas, (ctx, w, h) => {
    const small = w < 480;
    const pad = { l: small ? 44 : 56, r: 12, t: 26, b: small ? 40 : 44 };
    const px = (x) => pad.l + ((Math.log10(x) - Math.log10(X[0])) / Math.log10(X[1] / X[0])) * (w - pad.l - pad.r);
    const py = (y) => h - pad.b - ((Math.log10(y) - Math.log10(Y[0])) / Math.log10(Y[1] / Y[0])) * (h - pad.t - pad.b);
    const ink = color('--ink'), ink2 = color('--ink-2'), line = color('--line'), faint = color('--faint');
    const accent = color('--accent');
    const fs = small ? 11 : 12;
    ctx.clearRect(0, 0, w, h);
    ctx.font = `${fs}px ${FONT}`;

    // Grid and axes, one line per power of ten.
    ctx.lineWidth = 1;
    ctx.strokeStyle = line;
    ctx.fillStyle = ink2;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
    for (let e = -1; e <= 4; e++) {
      const x = px(10 ** e);
      ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, h - pad.b); ctx.stroke();
      ctx.textAlign = e === 4 ? 'right' : 'center';
      const tick = small && e >= 3 ? `${10 ** (e - 3)}k` : fmtIntensity(10 ** e);
      ctx.fillText(tick, e === 4 ? x + 2 : x, h - pad.b + 6);
    }
    ctx.textAlign = 'center';
    ctx.fillText(`operations per byte (log scale${small ? ', k = thousand' : ''})`, pad.l + (w - pad.l - pad.r) / 2, h - pad.b + 8 + fs + 4);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let e = 10; e <= 15; e++) {
      const y = py(10 ** e);
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
      ctx.fillText(e >= 12 ? `${fmtCount(10 ** (e - 12))} T` : `${fmtCount(10 ** (e - 9))} G`, pad.l - 6, y);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('FLOP/s, log scale (T = trillion, G = billion)', 4, 2);

    // Each machine's roof: a slope (memory) meeting a flat line (compute).
    const roof = (m, stroke, width, dash) => {
      ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(px(X[0]), py(achievable(m, X[0])));
      ctx.lineTo(px(ridge(m)), py(m.peakFlops));
      ctx.lineTo(px(X[1]), py(m.peakFlops));
      ctx.stroke();
      // Ridge marker, dotted down to the axis, labeled for both machines.
      ctx.setLineDash([2, 3]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px(ridge(m)), py(m.peakFlops)); ctx.lineTo(px(ridge(m)), h - pad.b); ctx.stroke();
      ctx.setLineDash([]);
    };
    const other = MACHINES.find((m) => m !== machine);
    roof(other, faint, 1.5, [5, 4]);
    roof(machine, ink, 2.5, []);

    // Labels for the ridges just above the x axis, the faint one a row higher
    // so the two never collide.
    const ridgeLabel = (m, fg, bold, lift) => pill(ctx, `ridge ${fmtIntensity(ridge(m))}`, px(ridge(m)),
      h - pad.b - 14 - lift, { bg: color('--surface'), fg, size: bold ? fs + 1 : fs });
    ridgeLabel(other, ink2, false, fs + 14);
    ridgeLabel(machine, ink, true, 0);

    // Labels for the selected machine's two ceilings.
    ctx.fillStyle = ink;
    ctx.font = `600 ${fs + 1}px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    const peakLabel = (m) => `${small ? '' : `${m.name}: `}${fmtFlops(m.peakFlops)} ${m.precision}`;
    ctx.fillText(peakLabel(machine), w - pad.r - 4, py(machine.peakFlops) - 5);
    if (!small) {
      ctx.font = `${fs}px ${FONT}`;
      ctx.fillStyle = ink2;
      ctx.textBaseline = 'top';
      ctx.fillText(peakLabel(other), w - pad.r - 4, py(other.peakFlops) + 5);
    }
    // Memory label along the slope, a little way in from the left edge.
    const sx = small ? 0.15 : 0.5, sy = achievable(machine, sx);
    const slope = Math.atan2(py(achievable(machine, sx * 10)) - py(sy), px(sx * 10) - px(sx));
    ctx.save();
    ctx.translate(px(sx), py(sy) - 6);
    ctx.rotate(slope);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = ink;
    ctx.font = `600 ${fs + 1}px ${FONT}`;
    ctx.fillText(`memory: ${fmtBytes(machine.bandwidth)}`, 0, 0);
    ctx.restore();

    // The reader's point, the only thing in the accent color.
    const a = achievable(machine, intensity);
    ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(px(intensity), py(a)); ctx.lineTo(px(intensity), h - pad.b); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.arc(px(intensity), py(a), 7, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = color('--surface'); ctx.lineWidth = 2; ctx.stroke();
  });

  function describe(m, i) {
    const a = achievable(m, i);
    const memoryBound = i < ridge(m);
    return { a, memoryBound, share: fmtPercent(a / m.peakFlops) };
  }

  function update() {
    const r = describe(machine, intensity);
    const other = MACHINES.find((m) => m !== machine);
    const o = describe(other, intensity);
    const amount = fmtIntensity(intensity);
    out.value = out.textContent = amount;
    slider.setAttribute('aria-valuetext', `${amount} operations per byte`);
    machineButtons.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.machine === machine.id)));
    presets.forEach((b) => b.setAttribute('aria-pressed',
      String(toSlider(Number(b.dataset.intensity)) === Number(slider.value))));

    const head = r.memoryBound
      ? `<strong>Memory-bound.</strong> Data can’t arrive fast enough: the ${machine.name} reaches `
        + `${fmtFlops(r.a)}, ${r.share} of its ${machine.precision} peak, while its arithmetic waits.`
      : `<strong>Compute-bound.</strong> The ${machine.name} runs at its full ${fmtFlops(r.a)} `
        + `${machine.precision} peak; faster memory would not help.`;
    const tail = `The same work on the ${other.name} would be ${o.memoryBound ? 'memory' : 'compute'}-bound `
      + `at ${fmtFlops(o.a)} (${o.share} of its peak).`;
    verdict.innerHTML = `${head} <span class="aside">${tail}</span>`;
    desc.textContent = `Roofline chart on log scales. Horizontal axis: operations per byte, 0.1 to 10,000. `
      + `Vertical axis: achievable speed. ${machine.name}, solid: peak ${fmtFlops(machine.peakFlops)} `
      + `${machine.precision}, memory ${fmtBytes(machine.bandwidth)}, ridge at ${fmtIntensity(ridge(machine))} `
      + `operations per byte. ${other.name}, faint: peak ${fmtFlops(other.peakFlops)} ${other.precision}, `
      + `memory ${fmtBytes(other.bandwidth)}, ridge at ${fmtIntensity(ridge(other))}. `
      + `Your point: ${amount} operations per byte, ${fmtFlops(r.a)}, ${r.memoryBound ? 'memory' : 'compute'}-bound.`;
    paint();
  }

  slider.addEventListener('input', () => { intensity = toIntensity(Number(slider.value)); update(); });
  for (const b of presets) {
    b.addEventListener('click', () => {
      slider.value = toSlider(Number(b.dataset.intensity));
      intensity = Number(b.dataset.intensity);
      update();
    });
  }
  for (const b of machineButtons) {
    b.addEventListener('click', () => { machine = byId[b.dataset.machine]; update(); });
    b.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault();
      const next = machineButtons[(machineButtons.indexOf(b) + 1) % machineButtons.length];
      next.focus(); next.click();
    });
  }
  update();
}

// Beat 4 is prose only: its numbers are computed in data.js and already in the HTML.

// ---------------------------------------------------------------------------
// Boot: start each interactive beat and drop its "needs JavaScript" fallback.

const BEATS = { 1: beat1, 2: beat2, 3: beat3 };
for (const section of document.querySelectorAll('[data-beat]')) {
  const start = BEATS[section.dataset.beat];
  if (!start) continue;
  section.classList.add('live');
  try { start(section); } catch (err) { section.classList.remove('live'); console.error(err); }
}
