'use client';

/// FAX MACHINE button: links to /exhibit. The printer icon is grey until a
/// printer key is saved on this device; tapping the icon opens a pop-up to
/// enter one, which is checked against the print queue and then carried in
/// the link (/exhibit?key=…) so the exhibit can drive the physical machine.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, PrinterCheck, X } from 'lucide-react';

const STORAGE_KEY = 'nftfax.printerKey';

export function ExhibitButton({ className = '' }: { className?: string }) {
  const [key, setKey] = useState('');
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { setKey(localStorage.getItem(STORAGE_KEY) || ''); }, []);

  async function save() {
    const k = draft.trim();
    if (!k) { setError('Enter a printer key.'); return; }
    setChecking(true);
    setError('');
    try {
      const res = await fetch(`/api/exhibit/print?key=${encodeURIComponent(k)}&status=1`, { cache: 'no-store' });
      if (res.status === 401) { setError('That key was not accepted.'); return; }
      if (!res.ok) { setError('Could not reach the print queue. Try again.'); return; }
      localStorage.setItem(STORAGE_KEY, k);
      setKey(k);
      setOpen(false);
    } catch {
      setError('Could not reach the print queue. Try again.');
    } finally {
      setChecking(false);
    }
  }

  function forget() {
    localStorage.removeItem(STORAGE_KEY);
    setKey('');
    setDraft('');
  }

  return (
    <>
      <Link
        href={key ? `/exhibit?key=${encodeURIComponent(key)}` : '/exhibit'}
        className={`key-shadow flex items-center gap-1.5 border border-[#77705f] bg-[#d8d0bf] px-2 sm:px-3 py-2 text-[11px] sm:text-[12px] font-bold uppercase whitespace-nowrap ${className}`}
        title="FAX MACHINE exhibit"
      >
        <span
          role="button"
          tabIndex={0}
          aria-label={key ? 'Printer key saved — change it' : 'Add printer key'}
          title={key ? 'Printer key saved — tap to change' : 'Add printer key'}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDraft(key); setError(''); setOpen(true); }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setDraft(key); setError(''); setOpen(true); } }}
          className={`-m-1 p-1 ${key ? 'text-[#3d5a40]' : 'text-[#9a9282] opacity-60'}`}
        >
          <PrinterCheck size={13} />
        </span>
        FAX MACHINE
      </Link>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#25251f]/70 p-4" onClick={() => setOpen(false)}>
          <div className="machine-shadow w-full max-w-sm border border-[#8f8878] bg-[#c8c0ae]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-[#8f8878] bg-[#b5ad9d] px-4 py-2">
              <p className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[.16em]"><PrinterCheck size={14} /> Printer key</p>
              <button onClick={() => setOpen(false)} aria-label="Dismiss" className="key-shadow border border-[#77705f] bg-[#d8d0bf] p-1.5"><X size={14} /></button>
            </div>
            <form className="space-y-3 p-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
              <p className="text-[11px] uppercase tracking-wide text-[#4a4638]">
                Operators: add the key to send transmissions to the physical fax machine. Without one the exhibit is view only.
              </p>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="printer key"
                autoFocus
                spellCheck={false}
                autoComplete="off"
                className="w-full border border-[#847d6e] bg-[#eee8dc] px-3 py-2 font-mono text-sm outline-none focus:border-[#e65b2f]"
              />
              {error && <p className="border-l-4 border-[#a94228] bg-[#e2c9bc] p-2 text-[11px] font-bold uppercase text-[#a94228]">{error}</p>}
              <div className="flex items-center justify-between gap-2">
                {key ? (
                  <button type="button" onClick={forget} className="text-[11px] font-bold uppercase text-[#a94228] underline">Forget key</button>
                ) : <span />}
                <button type="submit" disabled={checking} className="key-shadow flex items-center gap-1 border border-[#983b21] bg-[#e65b2f] px-3 py-2 text-[11px] font-bold uppercase text-white disabled:opacity-60">
                  {checking && <Loader2 size={12} className="animate-spin" />} Save key
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
