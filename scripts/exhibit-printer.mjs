#!/usr/bin/env node
// The physical fax machine's daemon. Runs on the Mac the BYP800 is plugged into.
//
// It long-polls the print queue on nftfax.app, composes each job into an A4
// thermal sheet (header / cover note / the fax bitmap / footer), and hands it to
// CUPS. The Mac never accepts an inbound connection: the tablet in the gallery
// and this machine only ever talk through the queue.
//
//   EXHIBIT_PRINT_KEY=…  node scripts/exhibit-printer.mjs
//
//   NFTFAX_URL   origin to poll                  default https://nftfax.app
//   PRINTER      CUPS queue name                 default BYP800
//   DRY=1        render to /tmp, do not print
//   ONCE=<json>  render one synthetic job and exit (for layout work)
//
// Sheet: A4 at 203 dpi = 1654 × 2339 px, 1-bit, Courier, dashed rules — the same
// look as the tray permalink, because it is the same fax.

import { execFile } from 'node:child_process';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir, hostname } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';

const run = promisify(execFile);
const ORIGIN = process.env.NFTFAX_URL || 'https://nftfax.app';
const KEY = process.env.EXHIBIT_PRINT_KEY || '';
const PRINTER = process.env.PRINTER || 'BYP800';
const DRY = process.env.DRY === '1';
const W = 1654, H = 2339;                     // A4 @ 203 dpi
const M = 90;                                  // margin
const INFO = `${hostname().split('.')[0]} · ${PRINTER}`;

if (!KEY && !process.env.ONCE) { console.error('EXHIBIT_PRINT_KEY is required'); process.exit(1); }

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/// Wrap monospace text to a column count.
function wrap(text, cols) {
  const out = [];
  for (const para of String(text).split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if ((line + ' ' + word).trim().length > cols) { out.push(line); line = word; }
      else line = (line + ' ' + word).trim();
    }
    out.push(line);
  }
  return out;
}

/// Text block as an SVG layer. Courier at 203 dpi: 34 px ≈ 12 pt.
function textSvg(lines, { size = 34, weight = 'normal', x = M, width = W - 2 * M } = {}) {
  const lh = Math.round(size * 1.35);
  const body = lines.map((l, i) => `<text x="${x}" y="${lh * (i + 1)}" font-family="Courier, 'Courier New', monospace" font-size="${size}" font-weight="${weight}" fill="#000">${esc(l)}</text>`).join('');
  const h = lh * lines.length + 8;
  return { buf: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}">${body}</svg>`), h };
}
function rule() {
  const buf = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W - 2 * M}" height="6"><line x1="0" y1="3" x2="${W - 2 * M}" y2="3" stroke="#000" stroke-width="3" stroke-dasharray="14 10"/></svg>`);
  return { buf, h: 6 };
}

/// Compose one job into a 1-bit PNG. Returns the PNG buffer.
export async function renderSheet(job) {
  const isFax = job.event === 'fax';
  const layers = [];
  let y = M;
  const put = (layer) => { layers.push({ input: layer.buf, top: y, left: M }); y += layer.h; };
  const gap = (px) => { y += px; };

  // Header — mirrors the tray permalink, plus TO.
  const when = new Date(job.at || Date.now());
  const stamp = when.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  put(textSvg(['NFTFAX MACHINE  ·  ' + (isFax ? 'CARBON COPY TRANSMISSION' : 'INCOMING TRANSMISSION')], { size: 40, weight: 'bold' }));
  gap(10); put(rule()); gap(18);
  put(textSvg([
    `FROM: ${isFax ? job.from || 'Marfa@fax' : job.handle || ''}`,
    `TO:   ${isFax ? job.cc || 'LocalMachine@fax' : ''}`.trimEnd(),
    `T/#${String(job.trayId || '').toUpperCase()}    ${stamp}`,
    `FAX CHAIN #${job.tokenId}  ·  ${job.collection || ''}  ·  Hop ${Math.max(0, (job.chainDepth ?? 1) - 1)}`,
  ].filter(Boolean)));
  gap(10); put(rule()); gap(18);

  // Cover note (fax events only).
  if (isFax && job.coverNote) {
    put(textSvg(['CC: COVER NOTE'], { size: 30, weight: 'bold' }));
    put(textSvg(wrap(job.coverNote, 62)));
    gap(10); put(rule()); gap(18);
  }

  // The bitmap. Nearest-neighbour so the fax pixels stay crisp; greyscale then
  // threshold — the head only knows black and white anyway.
  const res = await fetch(job.imageUrl, { headers: { 'User-Agent': 'nftfax-exhibit-printer' } });
  if (!res.ok) throw new Error(`image ${res.status} ${job.imageUrl}`);
  const src = sharp(Buffer.from(await res.arrayBuffer())).flatten({ background: '#fff' });
  const meta = await src.metadata();
  const footerH = 170;
  const availW = W - 2 * M, availH = H - y - footerH - M;
  const scale = Math.min(availW / meta.width, availH / meta.height);
  const bw = Math.floor(meta.width * scale), bh = Math.floor(meta.height * scale);
  const bitmap = await src.resize(bw, bh, { kernel: 'nearest' }).greyscale().threshold(160).png().toBuffer();
  layers.push({ input: bitmap, top: y, left: Math.round((W - bw) / 2) });
  y += bh + 24;

  // Footer.
  put(rule()); gap(12);
  put(textSvg([
    `Minted to Base by ${job.minterEns || job.minter || ''}`.trimEnd(),
    `${ORIGIN.replace(/^https?:\/\//, '')}/tray/${job.trayId}    Printed ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC`,
  ], { size: 28 }));

  return sharp({ create: { width: W, height: H, channels: 3, background: '#fff' } })
    .composite(layers)
    .greyscale()
    .threshold(128)
    .png({ palette: true, colours: 2 })
    .toBuffer();
}

async function printPng(png, label) {
  const dir = await mkdtemp(join(tmpdir(), 'nftfax-print-'));
  const file = join(dir, `${label}.png`);
  await writeFile(file, png);
  if (DRY) { log('DRY — rendered', file); return file; }
  // fit-to-page keeps the sheet on A4 whatever the driver's default; media A4 so it does not pick letter.
  await run('lp', ['-d', PRINTER, '-o', 'media=A4', '-o', 'fit-to-page', '-t', label, file]);
  return file;
}

async function ack(id, ok, error) {
  await fetch(`${ORIGIN}/api/exhibit/print?key=${encodeURIComponent(KEY)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ack: { id, ok, error: error ? String(error).slice(0, 200) : undefined } }),
  }).catch((e) => log('ack failed', e.message));
}

async function loop() {
  log(`polling ${ORIGIN} → printer "${PRINTER}"${DRY ? ' (DRY)' : ''}`);
  let backoff = 1000;
  for (;;) {
    try {
      const r = await fetch(`${ORIGIN}/api/exhibit/print?key=${encodeURIComponent(KEY)}&wait=25&info=${encodeURIComponent(INFO)}`, { signal: AbortSignal.timeout(40_000) });
      if (r.status === 401) { console.error('queue rejected the key — check EXHIBIT_PRINT_KEY'); process.exit(1); }
      if (!r.ok) throw new Error(`poll ${r.status}`);
      const { jobs } = await r.json();
      backoff = 1000;
      for (const job of jobs) {
        const label = `fax-${job.tokenId}-${job.id}`;
        log(`job ${job.id} (attempt ${job.attempt}) #${job.tokenId} ${job.event} ${job.handle || ''}`);
        try {
          const png = await renderSheet(job);
          const file = await printPng(png, label);
          log(`  printed → ${file}`);
          await ack(job.id, true);
        } catch (e) {
          log(`  FAILED: ${e.message}`);
          await ack(job.id, false, e.message);
        }
      }
    } catch (e) {
      log(`poll error: ${e.message} — retry in ${backoff / 1000}s`);
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 30_000);
    }
  }
}

if (process.env.ONCE) {
  const job = { event: 'fax', at: new Date().toISOString(), tokenId: 21, trayId: 'd4172ce5fced', handle: 'atom.648@fax', collection: 'POW NFT', chainDepth: 3, minterEns: 'rgbanksy.eth', from: 'Marfa@fax', cc: 'LocalMachine@fax', coverNote: 'Greetings from Marfa. This fax crossed the Pacific to reach you.', imageUrl: `${ORIGIN}/api/tray/d4172ce5fced/image`, id: 'test', ...JSON.parse(process.env.ONCE === '1' ? '{}' : process.env.ONCE) };
  const png = await renderSheet(job);
  console.log(await printPng(png, 'nftfax-test'));
} else {
  loop();
}
