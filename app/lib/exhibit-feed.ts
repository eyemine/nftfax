import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';

export type ExhibitFeedNote = {
  id: string;
  seq: number;
  event: string;
  source: string;
  at: string;
  tokenId: number | null;
  from: string;
  visitor: string | null;
  coverNote: string;
};

type FeedStore = {
  seq: number;
  notes: ExhibitFeedNote[];
};

const MAX_NOTES = 50;
const FEED_DIR = process.env.EXHIBIT_DATA_DIR || join(process.cwd(), 'data');
const FEED_FILE = join(FEED_DIR, 'exhibit-feed.json');

const clean = (value: unknown, max: number) => String(value || '').replace(/[\x00-\x1f\x7f-\x9f]/g, '').trim().slice(0, max);
const cleanSource = (value: unknown) => clean(value, 32).toLowerCase().replace(/[^a-z0-9-]/g, '') || 'exhibit';

function cleanNote(value: unknown): ExhibitFeedNote | null {
  const input = value as Partial<ExhibitFeedNote> | null;
  const coverNote = clean(input?.coverNote, 140);
  if (!coverNote) return null;
  const numericToken = Number(input?.tokenId);
  const seq = Math.max(0, Math.floor(Number(input?.seq) || 0));
  return {
    id: clean(input?.id, 80) || `note-${seq}`,
    seq,
    event: clean(input?.event, 32) || 'fax',
    source: cleanSource(input?.source),
    at: clean(input?.at, 40) || new Date(0).toISOString(),
    tokenId: Number.isSafeInteger(numericToken) && numericToken >= 0 ? numericToken : null,
    from: clean(input?.from, 80),
    visitor: clean(input?.visitor, 40) || null,
    coverNote,
  };
}

function loadFeed(): FeedStore {
  try {
    const parsed = JSON.parse(readFileSync(FEED_FILE, 'utf8')) as { seq?: number; notes?: unknown[] };
    const notes = (parsed.notes || []).map(cleanNote).filter((note): note is ExhibitFeedNote => Boolean(note)).sort((a, b) => b.seq - a.seq).slice(0, MAX_NOTES);
    const seq = Math.max(Number(parsed.seq) || 0, ...notes.map((note) => note.seq));
    return { seq, notes };
  } catch {
    return { seq: 0, notes: [] };
  }
}

const g = globalThis as unknown as { __nftfaxExhibitFeed?: FeedStore };
const store: FeedStore = g.__nftfaxExhibitFeed ??= loadFeed();

function persistFeed() {
  try {
    mkdirSync(FEED_DIR, { recursive: true });
    const temp = `${FEED_FILE}.tmp`;
    writeFileSync(temp, JSON.stringify(store));
    renameSync(temp, FEED_FILE);
  } catch (cause) {
    console.error('[exhibit-feed] failed to persist feed', cause);
  }
}

export function recordExhibitNote(input: {
  event?: unknown;
  source?: unknown;
  tokenId?: unknown;
  from?: unknown;
  visitor?: unknown;
  coverNote?: unknown;
}): ExhibitFeedNote | null {
  const coverNote = clean(input.coverNote, 140);
  if (!coverNote) return null;
  const numericToken = Number(input.tokenId);
  const note: ExhibitFeedNote = {
    id: `${Date.now().toString(36)}-${(++store.seq).toString(36)}`,
    seq: store.seq,
    event: clean(input.event, 32) || 'fax',
    source: cleanSource(input.source),
    at: new Date().toISOString(),
    tokenId: Number.isSafeInteger(numericToken) && numericToken >= 0 ? numericToken : null,
    from: clean(input.from, 80),
    visitor: clean(input.visitor, 40) || null,
    coverNote,
  };
  store.notes.unshift(note);
  store.notes.length = Math.min(store.notes.length, MAX_NOTES);
  persistFeed();
  return note;
}

export function exhibitFeed(source?: unknown, limit = 20): ExhibitFeedNote[] {
  const wanted = source === undefined || source === null || String(source) === '' ? '' : cleanSource(source);
  const max = Math.min(20, Math.max(1, Math.floor(limit)));
  return store.notes.filter((note) => !wanted || note.source === wanted).slice(0, max);
}
