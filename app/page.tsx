'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { Check, Loader2, LockKeyhole, Radio, Send, ShieldCheck, Upload, Zap, Wallet, Inbox } from 'lucide-react';
import InTray from './components/InTray';

type Status = 'idle' | 'processing' | 'ready' | 'sending' | 'sent';
type View = 'send' | 'tray';

import { prepareImage } from './lib/image';

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
  const [manualAddress, setManualAddress] = useState('');
  const [hasMetaMask, setHasMetaMask] = useState(false);
  const [view, setView] = useState<View>('send');
  const walletAddress = manualAddress || wallets[0]?.address || '';
  const isConnected = authenticated || !!manualAddress;

  useEffect(() => {
    if (typeof window !== 'undefined' && window.ethereum) {
      setHasMetaMask(true);
    }
  }, []);

  const ticket = useMemo(() => Math.random().toString(36).slice(2, 6).toUpperCase(), []);

  async function connectMetaMask() {
    setError('');
    try {
      if (typeof window === 'undefined' || !window.ethereum) {
        throw new Error('MetaMask or an EIP-1193 wallet is required.');
      }
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' }) as string[];
      const first = accounts[0];
      if (!first) throw new Error('No account selected.');
      setManualAddress(first.toLowerCase());
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'MetaMask connection failed.');
    }
  }

  function handleDisconnect() {
    setManualAddress('');
    void logout();
  }

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
        {isConnected && walletAddress ? (
          <button onClick={handleDisconnect} className="key-shadow border border-[#77705f] bg-[#d8d0bf] px-3 py-2 text-[10px] font-bold uppercase">{walletAddress.slice(0, 6)}…{walletAddress.slice(-4)} / Sign out</button>
        ) : (
          <div className="flex gap-2">
            {hasMetaMask && (
              <button onClick={() => void connectMetaMask()} className="key-shadow flex items-center gap-2 border border-[#3c3c3c] bg-[#25251f] px-4 py-2 text-[10px] font-bold uppercase text-white"><Wallet size={14} /> MetaMask</button>
            )}
            <button onClick={login} disabled={!ready} className="key-shadow border border-[#9d3c20] bg-[#e65b2f] px-4 py-2 text-[10px] font-bold uppercase text-white disabled:opacity-50">Join / sign in</button>
          </div>
        )}
      </header>

      <div className="mx-auto mb-4 flex max-w-6xl gap-2">
        <button
          onClick={() => setView('send')}
          className={`key-shadow flex items-center gap-2 border px-4 py-2 text-[10px] font-bold uppercase tracking-[.14em] ${view === 'send' ? 'border-[#983b21] bg-[#e65b2f] text-white' : 'border-[#77705f] bg-[#d8d0bf]'}`}
        >
          <Send size={13} /> Send
        </button>
        <button
          onClick={() => setView('tray')}
          className={`key-shadow flex items-center gap-2 border px-4 py-2 text-[10px] font-bold uppercase tracking-[.14em] ${view === 'tray' ? 'border-[#983b21] bg-[#e65b2f] text-white' : 'border-[#77705f] bg-[#d8d0bf]'}`}
        >
          <Inbox size={13} /> In-Tray
        </button>
      </div>

      {view === 'tray' && (
        <section className="machine-shadow mx-auto max-w-6xl overflow-hidden rounded-[18px] border border-[#8f8878] bg-[#c8c0ae] p-5 md:p-8">
          <label className="mb-5 block max-w-md">
            <span className="mb-1.5 block text-[9px] font-bold uppercase tracking-[.18em]">Your mailbox</span>
            <div className="flex">
              <input value={mailbox} onChange={(event) => setMailbox(event.target.value)} placeholder="yourname" className="min-w-0 flex-1 border border-[#847d6e] bg-[#eee8dc] px-3 py-3 text-sm outline-none focus:border-[#e65b2f]" />
              <span className="border border-l-0 border-[#847d6e] bg-[#d5cebf] px-3 py-3 text-xs">@nftmail.box</span>
            </div>
          </label>
          <InTray local={mailbox} wallet={walletAddress} />
        </section>
      )}

      <section className={`machine-shadow mx-auto max-w-6xl overflow-hidden rounded-[18px] border border-[#8f8878] bg-[#c8c0ae] ${view === 'send' ? '' : 'hidden'}`}>
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

            {!isConnected || !walletAddress ? (
              <div className="flex w-full flex-col gap-2">
                {hasMetaMask && (
                  <button onClick={() => void connectMetaMask()} className="key-shadow flex w-full items-center justify-center gap-2 border border-[#3c3c3c] bg-[#25251f] px-5 py-4 text-xs font-black uppercase tracking-[.12em] text-white"><Wallet size={17} /> Connect MetaMask</button>
                )}
                <button onClick={login} disabled={!ready} className="key-shadow flex w-full items-center justify-center gap-2 border border-[#983b21] bg-[#e65b2f] px-5 py-4 text-xs font-black uppercase tracking-[.12em] text-white disabled:opacity-50"><LockKeyhole size={17} /> Join with email or social</button>
              </div>
            ) : (
              <button onClick={() => void transmit()} disabled={status === 'sending' || !base64} className="key-shadow flex w-full items-center justify-center gap-2 border border-[#983b21] bg-[#e65b2f] px-5 py-4 text-xs font-black uppercase tracking-[.12em] text-white disabled:cursor-not-allowed disabled:opacity-45">{status === 'sending' ? <Loader2 className="animate-spin" size={17} /> : <Send size={17} />} Transmit NFTfax</button>
            )}
            <p className="mt-4 text-center text-[8px] uppercase tracking-[.16em] text-[#625d51]">Basic: earn send credits by forwarding · Pro: unlimited internal · Premium: external + colour</p>
          </div>
        </div>
      </section>

      <footer className="mx-auto mt-5 flex max-w-6xl flex-col justify-between gap-2 text-[8px] font-bold uppercase tracking-[.14em] text-[#575347] sm:flex-row"><span>Powered by NFTmail.box / ERC-8004 identity</span><a href="https://nftmail.box" className="underline">Open full mailbox console →</a></footer>
    </main>
  );
}
