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
const g = globalThis as unknown as { __nftfaxExhibitFeed?: FeedStore };
const store: FeedStore = g.__nftfaxExhibitFeed ??= { seq: 0, notes: [] };

const clean = (value: unknown, max: number) => String(value || '').replace(/[\x00-\x1f\x7f-\x9f]/g, '').trim().slice(0, max);
const cleanSource = (value: unknown) => clean(value, 32).toLowerCase().replace(/[^a-z0-9-]/g, '') || 'exhibit';

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
  return note;
}

export function exhibitFeed(source?: unknown, limit = 20): ExhibitFeedNote[] {
  const wanted = source === undefined || source === null || String(source) === '' ? '' : cleanSource(source);
  const max = Math.min(20, Math.max(1, Math.floor(limit)));
  return store.notes.filter((note) => !wanted || note.source === wanted).slice(0, max);
}
