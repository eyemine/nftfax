/// Synthesised fax handshake for the exhibition display.
///
/// The physical machine at the operator's end prints; the sound of a fax
/// going through is produced HERE, by the page in the gallery, through
/// whatever speaker the tablet is attached to. The handshake is generated
/// with the Web Audio API; the printer that follows it is a short recording.
///
/// Sequence, loosely after T.30 (timings compressed for a room, ~9 s):
///   dial tone (350+440 Hz) → DTMF dial → CNG calling beep (1100 Hz)
///   → CED answer tone (2100 Hz) → V.21 handshake chirps → page data
///   (band-limited noise) → confirmation beep → (optional) printer recording.
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
export function primeFaxAudio(): void { const ac = audio(); if (ac) void loadPrinter(ac); }

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

/// The printer recording (public/sounds/printer.mp3, the full 36.5 s, from freesound
/// community "printer scan" via Pixabay). Fetched and decoded once, on the
/// first tap, so it is ready by the time a handshake finishes.
const PRINTER_URL = '/sounds/printer.mp3';
let printerBuf: AudioBuffer | null = null;
let printerLoad: Promise<AudioBuffer | null> | null = null;

function loadPrinter(ac: AudioContext): Promise<AudioBuffer | null> {
  printerLoad ??= fetch(PRINTER_URL)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
    .then((b) => ac.decodeAudioData(b))
    .then((buf) => (printerBuf = buf))
    .catch(() => { printerLoad = null; return null; }); // retry on the next print
  return printerLoad;
}

/// Plays the whole recording from `start`. If the file only finished loading
/// after `start` had passed, it joins at the point it would have reached.
function thermalPrint(ac: AudioContext, out: AudioNode, start: number) {
  const play = (buf: AudioBuffer) => {
    const at = Math.max(start, ac.currentTime + 0.02);
    const offset = at - start;
    if (offset >= buf.duration - 0.5) return;
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.connect(out);
    src.start(at, offset);
  };
  if (printerBuf) play(printerBuf);
  else void loadPrinter(ac).then((buf) => { if (buf) play(buf); });
}

/// Plays the handshake, then (with `thermalSec`) the printer recording in full.
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

  // The recording's own length once decoded; `thermalSec` until then.
  if (thermalSec > 0) { t += 0.4; thermalPrint(ac, master, t); t += printerBuf?.duration ?? thermalSec; }

  return Math.ceil((t - ac.currentTime) * 1000);
}
