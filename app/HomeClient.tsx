'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { usePrivy, useActiveWallet } from '@privy-io/react-auth';
import { Check, Loader2, LayersArrowDown, Radar, Send, Upload, Inbox, UserCheck, Info, Trophy, Dices, Backpack as BackpackIcon } from 'lucide-react';
import InTray from './components/InTray';

type Status = 'idle' | 'processing' | 'ready' | 'sending' | 'sent';
type View = 'send' | 'tray' | 'delegate' | 'backpack';

import { prepareImage } from './lib/image';
import { FAX_THEME, getCollectionTheme, type CollectionKey } from './lib/theme';
import { SkinPanel } from './components/SkinPanel';
import { DelegatePanel } from './components/DelegatePanel';
import { ChonkBackpack } from './components/ChonkBackpack';
import Link from 'next/link';

export default function HomeClient() {
  const { ready, authenticated, login, logout } = usePrivy();
  const activeWallet = useActiveWallet().wallet;
  const evmWallet = activeWallet && 'getEthereumProvider' in activeWallet ? activeWallet : undefined;
  const searchParams = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);
  const [mailbox, setMailbox] = useState('');
  const [recipient, setRecipient] = useState(searchParams.get('to') || '');
  const [fileName, setFileName] = useState('');
  const [base64, setBase64] = useState('');
  const [preview, setPreview] = useState('');
  const [sizeKb, setSizeKb] = useState(0);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [trayUrl, setTrayUrl] = useState('');
  const [view, setView] = useState<View>('send');
  const [collection, setCollection] = useState<CollectionKey | ''>('');
  const collectionTheme = useMemo(() => getCollectionTheme(collection || FAX_THEME.key), [collection]);
  const walletAddress = activeWallet?.address?.toLowerCase() || '';
  const isConnected = authenticated || !!walletAddress;
  const [rolofaxEntries, setRolofaxEntries] = useState<{ handle: string; wallet: string; collection: string }[]>([]);
  const [allRolofaxEntries, setAllRolofaxEntries] = useState<{ handle: string; wallet: string; collection: string }[]>([]);
  const [showSplash, setShowSplash] = useState(!searchParams.get('to'));

  const handleMailboxChange = (handle: string) => {
    setMailbox(handle);
    const entry = rolofaxEntries.find((e) => e.handle === handle);
    if (entry && (['chonk', 'deadfellaz', 'normie', 'pow'] as const).includes(entry.collection as CollectionKey)) {
      setCollection(entry.collection as CollectionKey);
    }
  };

  const ticket = useMemo(() => Math.random().toString(36).slice(2, 6).toUpperCase(), []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const collections = ['chonk', 'deadfellaz', 'normie', 'pow'];
        const results = await Promise.all(
          collections.map((col) =>
            fetch(`/api/telegraph/list?collection=${col}`, { cache: 'no-store' })
              .then((r) => r.json())
              .catch(() => ({ items: [] }))
          )
        );
        if (cancelled) return;
        const all = results.flatMap((r) => (r.items || []) as { handle: string; wallet: string; collection: string }[]);
        setAllRolofaxEntries(all);
        if (walletAddress) {
          setRolofaxEntries(all.filter((e) => e.wallet?.toLowerCase() === walletAddress));
        } else {
          setRolofaxEntries([]);
        }
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, [walletAddress]);

  const otherRolofaxEntries = useMemo(
    () => walletAddress ? allRolofaxEntries.filter((e) => e.wallet?.toLowerCase() !== walletAddress) : allRolofaxEntries,
    [allRolofaxEntries, walletAddress]
  );

  async function handleDisconnect() {
    await logout();
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
          fromLabel: mailbox.trim().toLowerCase().replace(/@nftmail\.box$/, '').replace(/@fax$/, ''),
          fromDomain: 'fax',
          collection,
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
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-2 sm:gap-3">
            <LayersArrowDown size={28} className="text-[#1a1a14]" />
            <div>
              <h1 className="text-lg sm:text-2xl font-black tracking-[-0.06em] sm:tracking-[-0.08em] leading-[0.95]">{showSplash ? (collection ? collectionTheme.siteName : 'NFTFAX') : collectionTheme.siteName}<span style={{ color: collectionTheme.accent }}>™</span></h1>
              {(!showSplash || collection) && <p className="text-[11px] sm:text-[11px] font-bold uppercase tracking-[0.2em] sm:tracking-[0.28em] text-[#625e52]">{collectionTheme.tagline}</p>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          {isConnected && walletAddress ? (
            <button onClick={handleDisconnect} className="key-shadow border border-[#77705f] bg-[#d8d0bf] px-2 sm:px-3 py-1.5 text-[11px] sm:text-[12px] font-bold uppercase whitespace-nowrap hover:bg-[#c0392b] hover:text-white hover:border-[#9d3c20] transition-colors">{walletAddress.slice(0, 6)}…{walletAddress.slice(-4)} · Disconnect</button>
          ) : (
            <button onClick={() => login()} disabled={!ready} className="key-shadow border border-[#9d3c20] bg-[#e65b2f] px-3 sm:px-4 py-1.5 text-[11px] sm:text-[12px] font-bold uppercase text-white disabled:opacity-50">Connect</button>
          )}
        </div>
      </header>

      <div className="mx-auto mb-4 flex max-w-6xl flex-wrap items-center gap-2 sm:grid sm:grid-cols-3">
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 sm:justify-self-start">
          <Link
            href="/pre-register"
            className="key-shadow flex items-center gap-1.5 sm:gap-2 border border-[#77705f] bg-[#d8d0bf] px-3 sm:px-4 py-2 text-[11px] sm:text-[12px] font-bold uppercase tracking-[.1em] sm:tracking-[.14em]"
          >
            <Radar size={12} /> Rolofax
          </Link>
          <button
            onClick={() => { setShowSplash(false); setView('send'); }}
            className={`key-shadow flex items-center gap-1.5 sm:gap-2 border px-3 sm:px-4 py-2 text-[11px] sm:text-[12px] font-bold uppercase tracking-[.1em] sm:tracking-[.14em] ${view === 'send' ? 'border-[#983b21] bg-[#e65b2f] text-white' : 'border-[#77705f] bg-[#d8d0bf]'}`}
          >
            <Send size={12} /> Send
          </button>
          <button
            onClick={() => { setShowSplash(false); setView('tray'); }}
            className={`key-shadow flex h-9 w-9 items-center justify-center gap-1.5 border sm:h-auto sm:w-auto sm:gap-2 sm:px-4 sm:py-2 text-[11px] sm:text-[12px] font-bold uppercase tracking-[.1em] sm:tracking-[.14em] ${view === 'tray' ? 'border-[#983b21] bg-[#e65b2f] text-white' : 'border-[#77705f] bg-[#d8d0bf]'}`}
          >
            <Inbox size={12} /> <span className="hidden sm:inline">Fax-Tray</span>
          </button>
          <Link
            href="/rolofax"
            className="key-shadow flex h-9 w-9 items-center justify-center gap-1.5 border border-[#77705f] bg-[#d8d0bf] sm:h-auto sm:w-auto sm:gap-2 sm:px-4 sm:py-2 text-[11px] sm:text-[12px] font-bold uppercase tracking-[.1em] sm:tracking-[.14em]"
          >
            <Trophy size={12} /> <span className="hidden sm:inline">Leaderboard</span>
          </Link>
          <Link
            href="/draw"
            className="key-shadow flex h-9 w-9 items-center justify-center gap-1.5 border border-[#77705f] bg-[#d8d0bf] sm:h-auto sm:w-auto sm:gap-2 sm:px-4 sm:py-2 text-[11px] sm:text-[12px] font-bold uppercase tracking-[.1em] sm:tracking-[.14em]"
          >
            <Dices size={12} /> <span className="hidden sm:inline">Prize Draw</span>
          </Link>
        </div>
        <Link
          href="/about"
          className="key-shadow flex items-center gap-1.5 sm:gap-2 border border-[#77705f] bg-[#d8d0bf] px-3 sm:px-4 py-2 text-[11px] sm:text-[12px] font-bold uppercase tracking-[.1em] sm:tracking-[.14em] sm:justify-self-center"
        >
          <Info size={12} /> About
        </Link>
        <div className="flex items-center gap-1.5 sm:gap-2 sm:justify-self-end">
          {(collection || FAX_THEME.key) === 'chonk' && (
            <button
              onClick={() => { setShowSplash(false); setView('backpack'); }}
              className={`key-shadow flex h-9 w-9 items-center justify-center gap-1.5 border sm:h-auto sm:w-auto sm:gap-2 sm:px-4 sm:py-2 text-[11px] sm:text-[12px] font-bold uppercase tracking-[.1em] sm:tracking-[.14em] ${view === 'backpack' ? 'border-[#983b21] bg-[#e65b2f] text-white' : 'border-[#77705f] bg-[#d8d0bf]'}`}
              title="View your Chonk backpacks (tokenbound.org replacement)"
            >
              <BackpackIcon size={12} /> <span className="hidden sm:inline">Backpack</span>
            </button>
          )}
          <button
            onClick={() => { setShowSplash(false); setView('delegate'); }}
            className={`hidden sm:flex items-center gap-1.5 sm:gap-2 key-shadow border px-3 sm:px-4 py-2 text-[11px] sm:text-[12px] font-bold uppercase tracking-[.1em] sm:tracking-[.14em] ${view === 'delegate' ? 'border-[#983b21] bg-[#e65b2f] text-white' : 'border-[#77705f] bg-[#d8d0bf]'}`}
          >
            <UserCheck size={12} /> Delegate
          </button>
        </div>
      </div>

      {showSplash ? (
        <SkinPanel theme={collectionTheme} className="machine-shadow mx-auto max-w-6xl overflow-hidden rounded-[18px] border border-[#8f8878] bg-[#c8c0ae]">
          <div className="relative min-h-[420px] flex flex-col items-center justify-center p-8 md:p-12 text-center">
            <div className="paper-noise absolute inset-0 opacity-30" />
            <div className="relative z-10 flex flex-col items-center">
              <LayersArrowDown size={72} className="mb-4 text-[#1a1a14]" />
              <h2 className="text-5xl font-black tracking-[-0.06em] leading-[0.9] mb-2">NFTFAX<span style={{ color: collectionTheme.accent }}>™</span></h2>
              <p className="text-[12px] sm:text-[12px] font-bold uppercase tracking-[.24em] text-[#625e52] mb-6">Internet bitmap transmission office</p>
              <div className="border-t border-b border-[#8f8878] py-4 px-6 mb-6 max-w-xl">
                <p className="text-sm font-bold mb-2">Chain-letter fax game on Base</p>
                <p className="text-[11px] text-[#575244] leading-relaxed">Welcome Chonks, &lsquo;sup Deadfellaz, howdy-doo-dee Normies, g&rsquo;day POW NFTers</p>
                <p className="text-[11px] text-[#575244] leading-relaxed">In the Rolofax, add your NFT to join the game and find a player to send an art fax to — start a Fax Chain. Check your fax-tray, got a fax? Select to forward then upload art and build the collage. Send to another @fax account to keep the chain alive! If you forward, you can mint your Hop for a chance to win a 0.404 ETH prize from the pool of 2,222 mints — 10 randomly selected winners.</p>
                <Link href="/draw" className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[.14em] text-[#8a3e1e] underline">
                  <Dices size={11} /> Track the prize draw
                </Link>
              </div>
              <Link
                href="/pre-register"
                className="key-shadow flex items-center gap-2 border border-[#9d3c20] bg-[#e65b2f] px-6 py-3 text-xs font-black uppercase tracking-[.14em] text-white hover:bg-[#c0392b] transition-colors"
              >
                <Radar size={16} /> Join the Rolofax directory
              </Link>
              <button
                onClick={() => setShowSplash(false)}
                className="mt-4 text-[11px] font-bold uppercase tracking-[.16em] text-[#625e52] underline hover:text-[#454138]"
              >
                Enter the office →
              </button>
            </div>
          </div>
        </SkinPanel>
      ) : (
      <>
      {view === 'tray' && (
        <SkinPanel theme={collectionTheme} className="machine-shadow mx-auto max-w-6xl overflow-hidden rounded-[18px] border border-[#8f8878] bg-[#c8c0ae] p-5 md:p-8">
          <label className="mb-5 block max-w-md">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[.18em]">Your fax handle</span>
            {rolofaxEntries.length > 0 && (
              <select value={mailbox} onChange={(event) => handleMailboxChange(event.target.value)} className="mb-2 w-full border border-[#847d6e] bg-[#eee8dc] px-3 py-2 text-xs outline-none focus:border-[#e65b2f]">
                <option value="">Select a Rolofax handle…</option>
                {rolofaxEntries.map((entry) => (
                  <option key={entry.handle} value={entry.handle}>{entry.handle}@fax ({entry.collection})</option>
                ))}
              </select>
            )}
            <div className="flex">
              <input value={mailbox} onChange={(event) => setMailbox(event.target.value)} placeholder={collectionTheme.mailboxPlaceholder} className="min-w-0 flex-1 border border-[#847d6e] bg-[#eee8dc] px-3 py-3 text-sm outline-none focus:border-[#e65b2f]" />
              <span className="border border-l-0 border-[#847d6e] bg-[#d5cebf] px-3 py-3 text-xs">@fax</span>
            </div>
          </label>
          <InTray local={mailbox} wallet={walletAddress} domain="fax" rolofaxOptions={otherRolofaxEntries.map((e) => ({ handle: e.handle, collection: e.collection }))} getEthereumProvider={evmWallet ? () => evmWallet.getEthereumProvider() : undefined} />
        </SkinPanel>
      )}

      {view === 'delegate' && (
        <SkinPanel theme={collectionTheme} className="machine-shadow mx-auto max-w-6xl overflow-hidden rounded-[18px] border border-[#8f8878] bg-[#c8c0ae] p-5 md:p-8">
          <DelegatePanel collection={collection || FAX_THEME.key} walletAddress={walletAddress} />
        </SkinPanel>
      )}

      {view === 'backpack' && (
        <SkinPanel theme={collectionTheme} className="machine-shadow mx-auto max-w-6xl overflow-hidden rounded-[18px] border border-[#8f8878] bg-[#c8c0ae]">
          <div className="border-b border-[#8f8878] bg-[#b5ad9d] px-5 py-3 text-[12px] font-bold uppercase tracking-[.16em]">
            Chonk backpacks — everything saved on-chain
          </div>
          <div className="p-5 md:p-8">
            <p className="mb-4 text-[11px] font-bold uppercase text-[#696457]">
              nftfax.app's own viewer for what's inside your Chonks' ERC-6551 backpacks on Base.
            </p>
            <ChonkBackpack walletAddress={walletAddress} />
          </div>
        </SkinPanel>
      )}

      <SkinPanel theme={collectionTheme} className={`machine-shadow mx-auto max-w-6xl overflow-hidden rounded-[18px] border border-[#8f8878] bg-[#c8c0ae] ${view === 'send' ? '' : 'hidden'}`}>
        <div className="flex items-center justify-between border-b border-[#8f8878] bg-[#b5ad9d] px-5 py-3 text-[12px] font-bold uppercase tracking-[.16em]">
          <span>NF-8004 / Network facsimile</span>
          <span className="flex items-center gap-2 text-[#456049]"><span className="h-2 w-2 animate-pulse rounded-full bg-[#56705a]" /> Line ready</span>
        </div>

        <div className="grid lg:grid-cols-[1.05fr_.95fr]">
          <div className="border-b border-[#918978] p-5 md:p-8 lg:border-b-0 lg:border-r">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[.24em] text-[#615c50]">Outgoing transmission</p>
                <h2 className="mt-1 text-xl font-black uppercase">Document feeder</h2>
              </div>
              <div className="border border-[#8e8778] bg-[#ded7c8] px-3 py-2 text-right">
                <p className="text-[11px] uppercase text-[#6e685a]">Job ticket</p><p className="font-bold">T/{ticket}</p>
              </div>
            </div>

            <button
              onClick={() => inputRef.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) void selectFile(file); }}
              className="paper-noise relative grid min-h-[310px] w-full place-items-center overflow-hidden border-2 border-dashed border-[#817a6c] bg-[#e7e0d1] p-6 text-center transition hover:bg-[#eee8dc]"
            >
              {preview ? <img src={preview} alt="Fax preview" className="max-h-[290px] max-w-full object-contain grayscale" /> : (
                <div><div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full border border-[#9a9282] bg-[#d5cebf]"><Upload size={26} /></div><p className="font-bold uppercase">Insert document</p><p className="mt-2 text-[12px] uppercase tracking-wider text-[#696457]">PNG · JPG · BMP / maximum intake 20MB</p></div>
              )}
              {status === 'processing' && <div className="absolute inset-0 grid place-items-center bg-[#e7e0d1]/90"><Loader2 className="animate-spin" /><p className="mt-10 text-[12px] font-bold uppercase">Calibrating image…</p></div>}
            </button>
            <input ref={inputRef} type="file" accept=".png,.jpg,.jpeg,.bmp,image/png,image/jpeg,image/bmp" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void selectFile(file); }} />
            <div className="mt-3 flex min-h-5 items-center justify-between text-[11px] font-bold uppercase text-[#615c50]"><span>{fileName || 'Feeder empty'}</span><span>{sizeKb ? `${sizeKb} KB / GREYSCALE` : 'Auto reduction enabled'}</span></div>
          </div>

          <div className="bg-[#bbb3a2] p-5 md:p-8">
            <div className="mb-5 border border-[#5c5f50] bg-[#31372e] p-4 text-[#a9c99f] shadow-inner">
              <div className="relative overflow-hidden"><div className="scanline absolute inset-y-0 w-1/3" /><p className="text-[11px] uppercase tracking-[.2em] text-[#7fa178]">Transmission monitor</p><p className="mt-2 text-sm font-bold">{status === 'sent' ? 'DELIVERY CONFIRMED' : status === 'sending' ? 'DIALING REMOTE STATION…' : status === 'ready' ? 'DOCUMENT READY' : 'AWAITING DOCUMENT'}</p></div>
            </div>

            <label className="mb-5 block"><span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[.18em]">From fax handle</span>{rolofaxEntries.length > 0 && (<select value={mailbox} onChange={(event) => handleMailboxChange(event.target.value)} className="mb-2 w-full border border-[#847d6e] bg-[#eee8dc] px-3 py-2 text-xs outline-none focus:border-[#e65b2f]"><option value="">Select a Rolofax handle…</option>{rolofaxEntries.map((entry) => (<option key={entry.handle} value={entry.handle}>{entry.handle}@fax ({entry.collection})</option>))}</select>)}<div className="flex"><input value={mailbox} onChange={(event) => setMailbox(event.target.value)} placeholder={collectionTheme.mailboxPlaceholder} className="min-w-0 flex-1 border border-[#847d6e] bg-[#eee8dc] px-3 py-3 text-sm outline-none focus:border-[#e65b2f]" /><span className="border border-l-0 border-[#847d6e] bg-[#d5cebf] px-3 py-3 text-xs">@fax</span></div></label>
            <label className="mb-5 block"><span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[.18em]">Destination address</span>{otherRolofaxEntries.length > 0 && (<select value={recipient.includes('@fax') ? recipient.replace(/@fax$/, '') : ''} onChange={(event) => { const h = event.target.value; setRecipient(h ? `${h}@fax` : ''); }} className="mb-2 w-full border border-[#847d6e] bg-[#eee8dc] px-3 py-2 text-xs outline-none focus:border-[#e65b2f]"><option value="">Select from Rolofax directory…</option>{otherRolofaxEntries.map((entry) => (<option key={entry.handle} value={entry.handle}>{entry.handle}@fax ({entry.collection})</option>))}</select>)}<input value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="recipient@nftmail.box or recipient@fax" type="email" className="w-full border border-[#847d6e] bg-[#eee8dc] px-3 py-3 text-sm outline-none focus:border-[#e65b2f]" /></label>

            {error && <div className="mb-4 border-l-4 border-[#a94228] bg-[#e2c9bc] p-3 text-[12px] font-bold">FAULT: {error}</div>}
            {trayUrl && <a href={trayUrl} target="_blank" rel="noreferrer" className="mb-4 flex items-center gap-2 border-l-4 border-[#56705a] bg-[#cad8c7] p-3 text-[12px] font-bold underline"><Check size={15} /> Transmission received — open receipt</a>}

            <button onClick={() => isConnected ? void transmit() : login()} disabled={status === 'sending' || (isConnected && !base64)} className={`key-shadow flex w-full items-center justify-center gap-2 border border-[#983b21] bg-[#e65b2f] px-5 py-4 text-xs font-black uppercase tracking-[.12em] text-white transition-opacity ${!isConnected ? 'opacity-40' : 'disabled:cursor-not-allowed disabled:opacity-45'}`}>{status === 'sending' ? <Loader2 className="animate-spin" size={17} /> : <Send size={17} />} Transmit NFTfax</button>
            <p className="mt-4 text-center text-[11px] uppercase tracking-[.16em] text-[#625d51]">Basic: earn send credits by forwarding · Pro: unlimited internal · Premium: external + colour</p>
          </div>
        </div>
      </SkinPanel>
      </>
      )}

      <footer className="mx-auto mt-5 flex max-w-6xl flex-col justify-between gap-2 text-[11px] font-bold uppercase tracking-[.14em] text-[#575347] sm:flex-row"><span>Powered by NFTmail.box / ERC-8004 identity</span><div className="flex gap-4"><a href="/pre-register" className="underline">Pre-register for launch →</a><a href="https://nftmail.box" className="underline">Open full mailbox console →</a></div></footer>
    </main>
  );
}
