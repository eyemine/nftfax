'use client';

/// Error boundary for the exhibition display.
///
/// The venue device is an iPad with no console. Without this, a client-side
/// exception leaves a blank or half-rendered screen and nothing to report. This
/// puts the message on screen so it can be read off the device, and offers a
/// one-tap reset.
export default function ExhibitError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="grid h-[100dvh] w-screen place-items-center bg-[#c8c0ae] p-8 text-[#25251f]">
      <div className="max-w-2xl border-4 border-[#a94228] bg-[#e2c9bc] p-6">
        <p className="text-[12px] font-black uppercase tracking-[.3em] text-[#a94228]">Transmission fault</p>
        <p className="mt-2 break-words font-mono text-sm">{error.message || 'Unknown client error'}</p>
        {error.digest && <p className="mt-1 font-mono text-[11px] text-[#625e52]">digest {error.digest}</p>}
        <button onClick={reset} className="key-shadow mt-4 border border-[#983b21] bg-[#e65b2f] px-4 py-2 text-[12px] font-black uppercase tracking-[.12em] text-white">
          Reset display
        </button>
      </div>
    </main>
  );
}
