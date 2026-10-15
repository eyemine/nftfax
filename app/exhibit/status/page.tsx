'use client';

/// /exhibit/status?key=K — one glance at the whole exhibit: every kiosk's last
/// heartbeat (battery, charging, Wi-Fi, screen) and the printer daemon and
/// queue. Same key as /exhibit. Refreshes every 15 s.

import { useEffect, useState } from 'react';

type Kiosk = {
  id: string; seenAt: number; online: boolean; lowBattery: boolean;
  battery: number | null; charging: boolean | null; wifiSsid: string | null; wifiSignal: number | null;
  screenOn: boolean | null; fully: boolean; agent: string; page: string;
};
type Printer = { daemonOnline: boolean; daemonSeenAt: number | null; daemonInfo: string | null; pending: number; inFlight: number; printed: number; failed: number; lastError: string | null };

const ago = (ms: number | null) => {
  if (!ms) return 'never';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
};
const Dot = ({ ok, warn }: { ok: boolean; warn?: boolean }) => (
  <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${!ok ? 'bg-[#a94228]' : warn ? 'bg-[#c08a2f]' : 'bg-[#3d5a40]'}`} />
);

export default function ExhibitStatusPage() {
  const [key, setKey] = useState('');
  const [kiosks, setKiosks] = useState<Kiosk[] | null>(null);
  const [printer, setPrinter] = useState<Printer | null>(null);
  const [error, setError] = useState('');
  const [, setTick] = useState(0);

  useEffect(() => {
    setKey(new URLSearchParams(window.location.search).get('key') || '');
    document.getElementById('exhibit-diag-hyd')?.replaceChildren('hydrated');
  }, []);

  useEffect(() => {
    if (!key) return;
    let stop = false;
    const load = async () => {
      try {
        const q = `key=${encodeURIComponent(key)}`;
        const [k, p] = await Promise.all([fetch(`/api/exhibit/kiosk?${q}`, { cache: 'no-store' }), fetch(`/api/exhibit/print?${q}&status=1`, { cache: 'no-store' })]);
        if (k.status === 401 || p.status === 401) throw new Error('wrong key');
        if (stop) return;
        setKiosks((await k.json()).kiosks || []);
        setPrinter(await p.json());
        setError('');
      } catch (cause) {
        if (!stop) setError(cause instanceof Error ? cause.message : 'unavailable');
      }
    };
    void load();
    const t = setInterval(load, 15_000);
    const clock = setInterval(() => setTick((n) => n + 1), 5_000);
    return () => { stop = true; clearInterval(t); clearInterval(clock); };
  }, [key]);

  return (
    <main className="min-h-screen bg-[#e8e4d8] p-4 text-[#25251f] sm:p-8" style={{ fontFamily: '"Courier New", monospace' }}>
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-1 text-2xl font-black tracking-[-0.04em]">EXHIBIT STATUS</h1>
        <p className="mb-6 text-[11px] font-bold uppercase tracking-[.18em] text-[#625e52]">Kiosks · printer · queue — refreshes every 15 s</p>
        {!key && <p className="border-l-4 border-[#a94228] bg-[#e2c9bc] p-3 text-[12px] font-bold uppercase">Open with ?key=… (the exhibit key)</p>}
        {error && <p className="mb-4 border-l-4 border-[#a94228] bg-[#e2c9bc] p-3 text-[12px] font-bold uppercase">FAULT: {error}</p>}

        <section className="mb-6 border-2 border-[#24251f] bg-[#f4f1e8]">
          <h2 className="border-b border-[#8f8878] bg-[#d8d0bf] px-3 py-2 text-[12px] font-black uppercase tracking-[.14em]">Printer (the fax machine)</h2>
          {printer ? (
            <div className="space-y-1 p-3 text-[13px]">
              <p className="font-bold"><Dot ok={printer.daemonOnline} />{printer.daemonOnline ? 'Online' : 'OFFLINE'} · last poll {ago(printer.daemonSeenAt)}{printer.daemonInfo ? ` · ${printer.daemonInfo}` : ''}</p>
              <p>{printer.pending} queued · {printer.inFlight} printing · {printer.printed} printed · {printer.failed} failed</p>
              {printer.lastError && <p className="text-[#a94228]">Last error: {printer.lastError}</p>}
            </div>
          ) : <p className="p-3 text-[12px] text-[#625e52]">…</p>}
        </section>

        <section className="border-2 border-[#24251f] bg-[#f4f1e8]">
          <h2 className="border-b border-[#8f8878] bg-[#d8d0bf] px-3 py-2 text-[12px] font-black uppercase tracking-[.14em]">Kiosks</h2>
          {kiosks === null ? <p className="p-3 text-[12px] text-[#625e52]">…</p> : kiosks.length === 0 ? (
            <p className="p-3 text-[12px] text-[#625e52]">No heartbeat yet. Open the kiosk at /exhibit?key=…&amp;kiosk=marfa-1</p>
          ) : kiosks.map((k) => (
            <div key={k.id} className="space-y-1 border-b border-dashed border-[#8f8878] p-3 text-[13px] last:border-b-0">
              <p className="font-bold"><Dot ok={k.online} warn={k.lowBattery} />{k.id} · {k.online ? 'online' : 'OFFLINE'} · last heartbeat {ago(k.seenAt)}</p>
              <p>
                Battery {k.battery === null ? '?' : `${k.battery}%`}{k.charging === true ? ' · charging' : k.charging === false ? ' · unplugged' : ''}
                {k.lowBattery && <span className="font-bold text-[#a94228]"> · LOW</span>}
                {' · '}Wi-Fi {k.wifiSsid || '?'}{k.wifiSignal !== null ? ` (${k.wifiSignal})` : ''}
                {k.screenOn !== null && ` · screen ${k.screenOn ? 'on' : 'off'}`}
              </p>
              <p className="text-[11px] text-[#625e52]">{k.fully ? 'Fully Kiosk' : 'browser (enable Fully’s JavaScript Interface for Wi-Fi/charging)'} · {k.page}</p>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}
