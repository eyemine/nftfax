/// Synthesised fax handshake for the exhibition display.
///
/// The physical machine at the operator's end prints; the sound of a fax
/// going through is produced HERE, by the page in the gallery, through
/// whatever speaker the tablet is attached to. Everything is generated with
/// the Web Audio API — no sample file to host, no fetch, works offline once the
/// page is up.
///
/// Sequence, loosely after T.30 (timings compressed for a room, ~9 s):
///   dial tone (350+440 Hz) → DTMF dial → CNG calling beep (1100 Hz)
///   → CED answer tone (2100 Hz) → V.21 handshake chirps → page data
///   (band-limited noise) → confirmation beep.
///
/// Browsers require a user gesture before audio may start. The exhibit calls
/// this from a tap handler (the print button), which satisfies that; the
/// automatic mint path calls it too, which works once any tap has occurred on
/// the page, and silently does nothing before that.

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/// Call from a user gesture to unlock audio for later automatic playback.
export function primeFaxAudio(): void { audio(); }

function tone(ac: AudioContext, out: AudioNode, freqs: number[], start: number, dur: number, gain = 0.18) {
  const g = ac.createGain();
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(gain / freqs.length, start + 0.008);
  g.gain.setValueAtTime(gain / freqs.length, start + dur - 0.012);
  g.gain.linearRampToValueAtTime(0, start + dur);
  g.connect(out);
  for (const f of freqs) {
    const o = ac.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    o.connect(g);
    o.start(start);
    o.stop(start + dur);
  }
}

/// Band-limited noise: the sound of page data going down the line.
function noise(ac: AudioContext, out: AudioNode, start: number, dur: number, gain = 0.12) {
  const len = Math.ceil(ac.sampleRate * dur);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buf;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1900;
  bp.Q.value = 0.9;
  const g = ac.createGain();
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(gain, start + 0.05);
  g.gain.setValueAtTime(gain, start + dur - 0.08);
  g.gain.linearRampToValueAtTime(0, start + dur);
  src.connect(bp).connect(g).connect(out);
  src.start(start);
  src.stop(start + dur);
}

const DTMF: Record<string, [number, number]> = {
  '1': [697, 1209], '2': [697, 1336], '3': [697, 1477], '4': [770, 1209], '5': [770, 1336],
  '6': [770, 1477], '7': [852, 1209], '8': [852, 1336], '9': [852, 1477], '0': [941, 1336],
};

/// A thermal printer running for `dur` seconds: the head's line-strobe buzz
/// (gated noise), the paper stepper's whine, printing in uneven bursts the way
/// image rows vary, then a paper feed and the cutter. One looped 1 s noise
/// buffer, so a long print costs no more memory than a short one.
function thermalPrint(ac: AudioContext, out: AudioNode, start: number, dur: number) {
  const end = start + dur;
  const feedAt = end - 1.4;
  const bus = ac.createGain();
  bus.gain.setValueAtTime(0, start);
  bus.connect(out);

  // Print head: bandpassed noise, chopped at the line rate.
  const buf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const head = ac.createBufferSource();
  head.buffer = buf;
  head.loop = true;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 3200;
  bp.Q.value = 1.4;
  const gate = ac.createGain();
  gate.gain.value = 0.5;
  const lfo = ac.createOscillator();
  lfo.type = 'square';
  lfo.frequency.value = 88;
  const depth = ac.createGain();
  depth.gain.value = 0.5;
  lfo.connect(depth).connect(gate.gain);
  const headGain = ac.createGain();
  headGain.gain.value = 0.11;
  head.connect(bp).connect(gate).connect(headGain).connect(bus);

  // Paper stepper: a filtered square whine with a little wobble.
  const motor = ac.createOscillator();
  motor.type = 'square';
  motor.frequency.setValueAtTime(410, start);
  const wob = ac.createOscillator();
  wob.frequency.value = 6;
  const wobDepth = ac.createGain();
  wobDepth.gain.value = 6;
  wob.connect(wobDepth).connect(motor.frequency);
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1300;
  const motorGain = ac.createGain();
  motorGain.gain.value = 0.035;
  motor.connect(lp).connect(motorGain).connect(bus);

  // Uneven bursts: rows of an image print at different densities, with short
  // stalls while the next band is sent.
  let t = start;
  while (t < feedAt) {
    const run = 0.25 + Math.random() * 0.6;
    bus.gain.setTargetAtTime(0.65 + Math.random() * 0.35, t, 0.015);
    t += run;
    if (t < feedAt && Math.random() < 0.35) {
      bus.gain.setTargetAtTime(0.08, t, 0.02);
      t += 0.06 + Math.random() * 0.1;
    }
  }
  // Paper feed: head off, motor up a tone, then the cutter.
  bus.gain.setTargetAtTime(0.7, feedAt, 0.02);
  headGain.gain.setTargetAtTime(0, feedAt, 0.02);
  motor.frequency.setValueAtTime(560, feedAt);
  bus.gain.setTargetAtTime(0, end - 0.35, 0.03);
  for (const at of [end - 0.3, end - 0.18]) noise(ac, out, at, 0.04, 0.22);

  for (const n of [head, lfo, motor, wob]) { n.start(start); n.stop(end); }
}

/// Plays the handshake, then (with `thermalSec`) the printer printing it.
/// Returns the total duration in ms so the caller can hold its visual state
/// for the same time. Never throws: on a device without Web Audio it returns
/// 0 and the display simply runs silent.
export function playFaxHandshake(digits = '4326293', { thermalSec = 0 }: { thermalSec?: number } = {}): number {
  const ac = audio();
  if (!ac) return 0;
  const master = ac.createGain();
  master.gain.value = 0.9;
  master.connect(ac.destination);
  let t = ac.currentTime + 0.05;

  // Dial tone, then the number.
  tone(ac, master, [350, 440], t, 0.9); t += 1.0;
  for (const ch of digits) {
    const pair = DTMF[ch];
    if (pair) { tone(ac, master, pair, t, 0.09, 0.16); t += 0.15; }
  }
  t += 0.35;

  // Calling tone: 1100 Hz, 0.5 s on, (compressed) 0.6 s off, twice.
  for (let i = 0; i < 2; i++) { tone(ac, master, [1100], t, 0.5, 0.15); t += 1.1; }

  // Answer tone: 2100 Hz.
  tone(ac, master, [2100], t, 1.6, 0.14); t += 1.75;

  // V.21 handshake chirps: alternating 1650/1850 Hz bursts.
  for (let i = 0; i < 10; i++) { tone(ac, master, [i % 2 ? 1850 : 1650], t, 0.075, 0.13); t += 0.085; }
  t += 0.2;

  // Page data.
  noise(ac, master, t, 2.6); t += 2.7;

  // Confirmation.
  tone(ac, master, [1650], t, 0.18, 0.12); t += 0.25;
  tone(ac, master, [1650], t, 0.18, 0.12); t += 0.3;

  if (thermalSec > 0) { t += 0.4; thermalPrint(ac, master, t, thermalSec); t += thermalSec; }

  return Math.ceil((t - ac.currentTime) * 1000);
}
