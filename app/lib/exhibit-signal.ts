export type ExhibitSignal = {
  seq: number;
  event: string;
  source: string;
  at: string;
  tokenId: number | null;
};

type SignalStore = {
  signal: ExhibitSignal;
  waiters: Array<() => void>;
};

const g = globalThis as unknown as { __nftfaxExhibitSignal?: SignalStore };
const store: SignalStore = g.__nftfaxExhibitSignal ??= {
  signal: { seq: 0, event: '', source: '', at: '', tokenId: null },
  waiters: [],
};

export function publishExhibitSignal(event: string, tokenId?: unknown, source?: unknown): ExhibitSignal {
  const numericToken = Number(tokenId);
  store.signal = {
    seq: store.signal.seq + 1,
    event: String(event || 'print').slice(0, 32),
    source: String(source || 'exhibit').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32) || 'exhibit',
    at: new Date().toISOString(),
    tokenId: Number.isSafeInteger(numericToken) && numericToken >= 0 ? numericToken : null,
  };
  const waiters = store.waiters.splice(0);
  for (const resolve of waiters) resolve();
  return store.signal;
}

export function currentExhibitSignal(): ExhibitSignal {
  return store.signal;
}

export function waitForExhibitSignal(since: number, waitMs: number): Promise<ExhibitSignal> {
  if (store.signal.seq !== since || waitMs <= 0) return Promise.resolve(store.signal);
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const index = store.waiters.indexOf(finish);
      if (index >= 0) store.waiters.splice(index, 1);
      resolve(store.signal);
    };
    const timer = setTimeout(finish, waitMs);
    store.waiters.push(finish);
  });
}
