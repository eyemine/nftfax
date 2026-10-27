'use client';

/// Rolofax dropdown options grouped by the holder wallet, each group labelled
/// with the wallet's ENS name when it has one (else 0x1234…abcd). Render it
/// inside a <select>. ENS names are looked up once per wallet per page load
/// through /api/ens, in one batch, and shared by every dropdown on the page.

import { useEffect, useMemo, useState } from 'react';

export interface RolofaxOption { handle: string; collection: string; wallet?: string }

const names = new Map<string, string | null>();
const inflight = new Set<string>();
const listeners = new Set<() => void>();

async function lookup(addresses: string[]) {
  const todo = addresses.filter((a) => !names.has(a) && !inflight.has(a));
  if (todo.length === 0) return;
  todo.forEach((a) => inflight.add(a));
  try {
    const res = await fetch('/api/ens', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ addresses: todo }) });
    const json = (await res.json()) as { names?: Record<string, string> };
    for (const a of todo) names.set(a, json.names?.[a] ?? json.names?.[a.toLowerCase()] ?? null);
  } catch {
    // Non-fatal: groups fall back to the short address. Not cached, so a
    // later dropdown can retry.
  } finally {
    todo.forEach((a) => inflight.delete(a));
    listeners.forEach((fn) => fn());
  }
}

export function useEnsNames(addresses: string[]): Map<string, string | null> {
  const [, bump] = useState(0);
  const key = Array.from(new Set(addresses.map((a) => a.toLowerCase()).filter(Boolean))).sort().join(',');
  useEffect(() => {
    const fn = () => bump((n) => n + 1);
    listeners.add(fn);
    if (key) void lookup(key.split(','));
    return () => { listeners.delete(fn); };
  }, [key]);
  return names;
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const tokenNum = (h: string) => Number(h.match(/\.(\d+)$/)?.[1] ?? Number.MAX_SAFE_INTEGER);

export function RolofaxOptionGroups({ entries, firstWallet, label }: {
  entries: RolofaxOption[];
  /// This wallet's group goes first (e.g. the connected wallet).
  firstWallet?: string;
  /// Option text; defaults to "handle@fax (collection)".
  label?: (e: RolofaxOption) => string;
}) {
  const ens = useEnsNames(entries.map((e) => e.wallet || ''));
  const groups = useMemo(() => {
    const by = new Map<string, RolofaxOption[]>();
    for (const e of entries) {
      const w = (e.wallet || '').toLowerCase();
      const g = by.get(w);
      if (g) g.push(e); else by.set(w, [e]);
    }
    const first = (firstWallet || '').toLowerCase();
    return Array.from(by, ([wallet, list]) => ({
      wallet,
      name: wallet ? ens.get(wallet) || short(wallet) : 'Unknown holder',
      list: list.sort((a, b) => a.collection.localeCompare(b.collection) || tokenNum(a.handle) - tokenNum(b.handle) || a.handle.localeCompare(b.handle)),
    })).sort((a, b) => Number(b.wallet === first) - Number(a.wallet === first) || a.name.localeCompare(b.name));
  // `ens` is a stable Map mutated in place; `entries` changing or a lookup
  // finishing (which re-renders this component) both recompute.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, firstWallet, ens.size]);

  return (
    <>
      {groups.map((g) => (
        <optgroup key={g.wallet || 'unknown'} label={`${g.name} · ${g.list.length}`}>
          {g.list.map((e) => (
            <option key={e.handle} value={e.handle}>{label ? label(e) : `${e.handle}@fax (${e.collection})`}</option>
          ))}
        </optgroup>
      ))}
    </>
  );
}
