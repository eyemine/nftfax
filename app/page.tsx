'use client';

import { useMemo, useRef, useState } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { Check, Loader2, LockKeyhole, Radio, Send, ShieldCheck, Upload, Zap } from 'lucide-react';

type Status = 'idle' | 'processing' | 'ready' | 'sending' | 'sent';

const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_ENCODED_LENGTH = 1_300_000;

function stripDataUri(value: string): string {
  const comma = value.indexOf(',');
  return comma >= 0 ? value.slice(comma + 1) : value;
}

async function prepareImage(file: File): Promise<{ base64: string; preview: string; sizeKb: number }> {
  if (file.size > MAX_SOURCE_BYTES) throw new Error('Source image exceeds the 20MB intake limit.');
  const bitmap = await createImageBitmap(file);
  const initialScale = Math.min(1, 1728 / bitmap.width, 2200 / bitmap.height);
  let scale = initialScale;
  let dataUri = '';

  for (let attempt = 0; attempt < 7; attempt += 1) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(320, Math.round(bitmap.width * scale));
    canvas.height = Math.max(400, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('This browser cannot operate the image processor.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < pixels.data.length; index += 4) {
      const grey = Math.round(pixels.data[index] * 0.299 + pixels.data[index + 1] * 0.587 + pixels.data[index + 2] * 0.114);
      pixels.data[index] = grey;
      pixels.data[index + 1] = grey;
      pixels.data[index + 2] = grey;
    }
    context.putImageData(pixels, 0, 0);
    dataUri = canvas.toDataURL('image/jpeg', 0.76);
    if (stripDataUri(dataUri).length <= MAX_ENCODED_LENGTH) break;
    scale *= 0.8;
  }
  bitmap.close();
  const base64 = stripDataUri(dataUri);
  if (!base64 || base64.length > MAX_ENCODED_LENGTH) throw new Error('The image could not be reduced to fax size.');
  return { base64, preview: dataUri, sizeKb: Math.round(base64.length * 0.75 / 1024) };
}

export default function Home() {
  const { ready, authenticated, login, logout } = usePrivy();
  const { wallets } = useWallets();
  const inputRef = useRef<HTMLInputElement>(null);
  const [mailbox, setMailbox] = useState('');
  const [recipient, setRecipient] = useState('');
  const [fileName, setFileName] = useState('');
  const [base64, setBase64] = useState('');
  const [preview, setPreview] = useState('');
  const [sizeKb, setSizeKb] = useState(0);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [trayUrl, setTrayUrl] = useState('');
  const walletAddress = wallets[0]?.address || '';

  const ticket = useMemo(() => Math.random().toString(36).slice(2, 6).toUpperCase(), []);

  async function selectFile(file: File) {
    setError('');
    setTrayUrl('');
    setStatus('processing');
    try {
      const prepared = await prepareImage(file);
      setBase64(prepared.base64);
      setPreview(prepared.preview);
      setSizeKb(prepared.sizeKb);
      setFileName(file.name);
      setStatus('ready');
    } catch (cause: unknown) {
      setStatus('idle');
      setError(cause instanceof Error ? cause.message : 'Image processing failed.');
    }
  }

  async function transmit() {
    setError('');
    setTrayUrl('');
    if (!walletAddress) return setError('Connect a wallet to authenticate the sending mailbox.');
    if (!mailbox.trim()) return setError('Enter your NFTmail mailbox name.');
    if (!recipient.includes('@')) return setError('Enter a valid recipient address.');
    if (!base64) return setError('Feed an image into the document tray.');

    setStatus('sending');
    try {
      const response = await fetch('/api/tray/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromLabel: mailbox.trim().toLowerCase().replace(/@nftmail\.box$/, ''),
          ownerWallet: walletAddress,
          to: recipient.trim(),
          format: 'jpg',
          dataBase64: base64,
          colorMode: 'greyscale',
        }),
      });
      const result = await response.json() as { trayUrl?: string; error?: string };
      if (!response.ok) throw new Error(result.error || 'Transmission failed.');
      setTrayUrl(result.trayUrl || '');
      setStatus('sent');
    } catch (cause: unknown) {
      setStatus('ready');
      setError(cause instanceof Error ? cause.message : 'Transmission failed.');
    }
  }

  return (
    <main className="min-h-screen px-4 py-6 md:px-8 md:py-10">
      <header className="mx-auto mb-5 flex max-w-6xl items-center justify-between border-b border-[#575244] pb-4">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-sm bg-[#25251f] text-[#efe8d8]"><Radio size={21} /></div>
          <div>
            <h1 className="text-2xl font-black tracking-[-0.08em]">NFTFAX<span className="text-[#e65b2f]">®</span></h1>
            <p className="text-[9px] font-bold uppercase tracking-[0.28em] text-[#625e52]">Internet document transmission office</p>
          </div>
        </div>
        {authenticated && walletAddress ? (
          <button onClick={logout} className="key-shadow border border-[#77705f] bg-[#d8d0bf] px-3 py-2 text-[10px] font-bold uppercase">{walletAddress.slice(0, 6)}…{walletAddress.slice(-4)} / Sign out</button>
        ) : (
          <button onClick={login} disabled={!ready} className="key-shadow border border-[#9d3c20] bg-[#e65b2f] px-4 py-2 text-[10px] font-bold uppercase text-white disabled:opacity-50">Join / sign in</button>
        )}
      </header>

      <section className="machine-shadow mx-auto max-w-6xl overflow-hidden rounded-[18px] border border-[#8f8878] bg-[#c8c0ae]">
        <div className="flex items-center justify-between border-b border-[#8f8878] bg-[#b5ad9d] px-5 py-3 text-[10px] font-bold uppercase tracking-[.16em]">
          <span>NF-8004 / Network facsimile</span>
          <span className="flex items-center gap-2 text-[#456049]"><span className="h-2 w-2 animate-pulse rounded-full bg-[#56705a]" /> Line ready</span>
        </div>

        <div className="grid lg:grid-cols-[1.05fr_.95fr]">
          <div className="border-b border-[#918978] p-5 md:p-8 lg:border-b-0 lg:border-r">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <p className="text-[9px] font-bold uppercase tracking-[.24em] text-[#615c50]">Outgoing transmission</p>
                <h2 className="mt-1 text-xl font-black uppercase">Document feeder</h2>
              </div>
              <div className="border border-[#8e8778] bg-[#ded7c8] px-3 py-2 text-right">
                <p className="text-[8px] uppercase text-[#6e685a]">Job ticket</p><p className="font-bold">T/{ticket}</p>
              </div>
            </div>

            <button
              onClick={() => inputRef.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) void selectFile(file); }}
              className="paper-noise relative grid min-h-[310px] w-full place-items-center overflow-hidden border-2 border-dashed border-[#817a6c] bg-[#e7e0d1] p-6 text-center transition hover:bg-[#eee8dc]"
            >
              {preview ? <img src={preview} alt="Fax preview" className="max-h-[290px] max-w-full object-contain grayscale" /> : (
                <div><div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full border border-[#9a9282] bg-[#d5cebf]"><Upload size={26} /></div><p className="font-bold uppercase">Insert document</p><p className="mt-2 text-[10px] uppercase tracking-wider text-[#696457]">PNG · JPG · BMP / maximum intake 20MB</p></div>
              )}
              {status === 'processing' && <div className="absolute inset-0 grid place-items-center bg-[#e7e0d1]/90"><Loader2 className="animate-spin" /><p className="mt-10 text-[10px] font-bold uppercase">Calibrating image…</p></div>}
            </button>
            <input ref={inputRef} type="file" accept=".png,.jpg,.jpeg,.bmp,image/png,image/jpeg,image/bmp" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void selectFile(file); }} />
            <div className="mt-3 flex min-h-5 items-center justify-between text-[9px] font-bold uppercase text-[#615c50]"><span>{fileName || 'Feeder empty'}</span><span>{sizeKb ? `${sizeKb} KB / GREYSCALE` : 'Auto reduction enabled'}</span></div>
          </div>

          <div className="bg-[#bbb3a2] p-5 md:p-8">
            <div className="mb-5 border border-[#5c5f50] bg-[#31372e] p-4 text-[#a9c99f] shadow-inner">
              <div className="relative overflow-hidden"><div className="scanline absolute inset-y-0 w-1/3" /><p className="text-[8px] uppercase tracking-[.2em] text-[#7fa178]">Transmission monitor</p><p className="mt-2 text-sm font-bold">{status === 'sent' ? 'DELIVERY CONFIRMED' : status === 'sending' ? 'DIALING REMOTE STATION…' : status === 'ready' ? 'DOCUMENT READY' : 'AWAITING DOCUMENT'}</p></div>
            </div>

            <label className="mb-4 block"><span className="mb-1.5 block text-[9px] font-bold uppercase tracking-[.18em]">From mailbox</span><div className="flex"><input value={mailbox} onChange={(event) => setMailbox(event.target.value)} placeholder="yourname" className="min-w-0 flex-1 border border-[#847d6e] bg-[#eee8dc] px-3 py-3 text-sm outline-none focus:border-[#e65b2f]" /><span className="border border-l-0 border-[#847d6e] bg-[#d5cebf] px-3 py-3 text-xs">@nftmail.box</span></div></label>
            <label className="mb-5 block"><span className="mb-1.5 block text-[9px] font-bold uppercase tracking-[.18em]">Destination address</span><input value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="recipient@nftmail.box" type="email" className="w-full border border-[#847d6e] bg-[#eee8dc] px-3 py-3 text-sm outline-none focus:border-[#e65b2f]" /></label>

            <div className="mb-5 grid grid-cols-3 gap-2 text-center text-[8px] font-bold uppercase"><div className="border border-[#958e7e] bg-[#cec6b6] p-2"><ShieldCheck size={15} className="mx-auto mb-1" />Bitmap only</div><div className="border border-[#958e7e] bg-[#cec6b6] p-2"><LockKeyhole size={15} className="mx-auto mb-1" />No trackers</div><div className="border border-[#958e7e] bg-[#cec6b6] p-2"><Zap size={15} className="mx-auto mb-1" />Auto reduce</div></div>

            {error && <div className="mb-4 border-l-4 border-[#a94228] bg-[#e2c9bc] p-3 text-[10px] font-bold">FAULT: {error}</div>}
            {trayUrl && <a href={trayUrl} target="_blank" rel="noreferrer" className="mb-4 flex items-center gap-2 border-l-4 border-[#56705a] bg-[#cad8c7] p-3 text-[10px] font-bold underline"><Check size={15} /> Transmission received — open receipt</a>}

            {!authenticated || !walletAddress ? <button onClick={login} disabled={!ready} className="key-shadow flex w-full items-center justify-center gap-2 border border-[#983b21] bg-[#e65b2f] px-5 py-4 text-xs font-black uppercase tracking-[.12em] text-white disabled:opacity-50"><LockKeyhole size={17} /> Join with email or social</button> : <button onClick={() => void transmit()} disabled={status === 'sending' || !base64} className="key-shadow flex w-full items-center justify-center gap-2 border border-[#983b21] bg-[#e65b2f] px-5 py-4 text-xs font-black uppercase tracking-[.12em] text-white disabled:cursor-not-allowed disabled:opacity-45">{status === 'sending' ? <Loader2 className="animate-spin" size={17} /> : <Send size={17} />} Transmit NFTfax</button>}
            <p className="mt-4 text-center text-[8px] uppercase tracking-[.16em] text-[#625d51]">Basic: 2 internal sends/month · Pro: unlimited external · Premium: colour + multipage</p>
          </div>
        </div>
      </section>

      <footer className="mx-auto mt-5 flex max-w-6xl flex-col justify-between gap-2 text-[8px] font-bold uppercase tracking-[.14em] text-[#575347] sm:flex-row"><span>Powered by NFTmail.box / ERC-8004 identity</span><a href="https://nftmail.box" className="underline">Open full mailbox console →</a></footer>
    </main>
  );
}
