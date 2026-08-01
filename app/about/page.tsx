import Link from 'next/link';
import { ArrowLeft, Info } from 'lucide-react';
import { FAX_THEME } from '../lib/theme';
import { SkinPanel } from '../components/SkinPanel';

export const metadata = {
  title: `Fax Chain Game — ${FAX_THEME.siteName}`,
};

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-[#c8c0ae] px-4 py-6 md:px-8 md:py-10">
      <div className="mx-auto max-w-4xl">
        <header className="mb-5 flex items-center justify-between border-b border-[#575244] pb-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-sm bg-[#25251f] text-[#efe8d8]">
              <Info size={21} />
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-[-0.08em]">FAX CHAIN GAME<span className="text-[#e65b2f]">®</span></h1>
              <p className="text-[9px] font-bold uppercase tracking-[0.28em] text-[#625e52]">Rules of the chain letter</p>
            </div>
          </div>
          <Link href="/" className="key-shadow border border-[#77705f] bg-[#d8d0bf] px-3 py-2 text-[10px] font-bold uppercase">Return to office</Link>
        </header>

        <div className="space-y-4">
          <SkinPanel theme={FAX_THEME} className="machine-shadow overflow-hidden rounded-[18px] border border-[#8f8878] bg-[#c8c0ae]">
            <div className="border-b border-[#8f8878] bg-[#b5ad9d] px-5 py-3 text-[10px] font-bold uppercase tracking-[.16em]">What it is</div>
            <div className="p-5 md:p-8 space-y-4 text-sm leading-relaxed text-[#3e3b34]">
              <p>
                NFTfax is a <strong className="text-[#25251f]">chain-letter game</strong> played over bitmap faxes.
                You send a document into the network; the next player adds to the chain by forwarding it.
                Each hop grows the chain, earns credits, and inches the whole thing closer to a permanent on-chain artifact.
              </p>
              <p>
                Every player is identified by their <strong>@fax</strong> handle — a community prefix plus the token they own, like <code>dfz.1234</code>.
                Only wallets holding the matching NFT for that handle can send from it.
              </p>
            </div>
          </SkinPanel>

          <SkinPanel theme={FAX_THEME} className="machine-shadow overflow-hidden rounded-[18px] border border-[#8f8878] bg-[#c8c0ae]">
            <div className="border-b border-[#8f8878] bg-[#b5ad9d] px-5 py-3 text-[10px] font-bold uppercase tracking-[.16em]">How to play</div>
            <div className="p-5 md:p-8 space-y-4 text-sm leading-relaxed text-[#3e3b34]">
              <ul className="space-y-2 list-disc pl-4">
                <li><strong>Register</strong> your <strong>@fax</strong> identity in the Telegraph directory before launch.</li>
                <li><strong>Send</strong> a greyscale image to any <code>prefix.tokenId@fax</code> address.</li>
                <li><strong>Forward</strong> public faxes you receive to keep the chain alive and earn +1 send credit.</li>
                <li><strong>Save</strong> a fax only after it has been forwarded — permanence is unlocked by participation.</li>
              </ul>
            </div>
          </SkinPanel>

          <SkinPanel theme={FAX_THEME} className="machine-shadow overflow-hidden rounded-[18px] border border-[#8f8878] bg-[#c8c0ae]">
            <div className="border-b border-[#8f8878] bg-[#b5ad9d] px-5 py-3 text-[10px] font-bold uppercase tracking-[.16em]">Credits & limits</div>
            <div className="p-5 md:p-8 space-y-4 text-sm leading-relaxed text-[#3e3b34]">
              <ul className="space-y-2 list-disc pl-4">
                <li>New <strong>@fax</strong> identities start with <strong>2 credits</strong>.</li>
                <li>Each <strong>forward</strong> earns <strong>+1 credit</strong>.</li>
                <li>You <strong>cannot send</strong> if your balance is <strong>0</strong>.</li>
                <li>When a line <strong>jams</strong> (72 hours pass), credits are drained. Clear the jam to reset to 1 credit.</li>
                <li>Sending your first <strong>@fax</strong> activates a free <strong>@nftmail.box</strong> basic inbox with 10 private sends.</li>
              </ul>
            </div>
          </SkinPanel>

          <SkinPanel theme={FAX_THEME} className="machine-shadow overflow-hidden rounded-[18px] border border-[#8f8878] bg-[#c8c0ae]">
            <div className="border-b border-[#8f8878] bg-[#b5ad9d] px-5 py-3 text-[10px] font-bold uppercase tracking-[.16em]">Thermal fade</div>
            <div className="p-5 md:p-8 space-y-4 text-sm leading-relaxed text-[#3e3b34]">
              <p>Public faxes age like thermal paper:</p>
              <ul className="space-y-2 list-disc pl-4">
                <li><strong>0–24h:</strong> crisp, full contrast.</li>
                <li><strong>24–72h:</strong> image fades to grey.</li>
                <li><strong>After 72h:</strong> the line is <strong>JAMMED</strong>. The image turns blank, the chain can no longer be forwarded, and the card is removed from the inbox after a total of 8 days.</li>
                <li>The sender address stays visible after a jam so someone can start a fresh chain with that player.</li>
              </ul>
            </div>
          </SkinPanel>

          <SkinPanel theme={FAX_THEME} className="machine-shadow overflow-hidden rounded-[18px] border border-[#8f8878] bg-[#c8c0ae]">
            <div className="border-b border-[#8f8878] bg-[#b5ad9d] px-5 py-3 text-[10px] font-bold uppercase tracking-[.16em]">Public vs private</div>
            <div className="p-5 md:p-8 space-y-4 text-sm leading-relaxed text-[#3e3b34]">
              <ul className="space-y-2 list-disc pl-4">
                <li><strong>@fax</strong> transmissions are <strong>public canvases</strong> — anyone can view them at <code>/tray/&#123;id&#125;</code>, with no encryption or private metadata.</li>
                <li><strong>@nftmail.box</strong> transmissions are private and cannot be opened by anyone except the recipient.</li>
                <li>The Telegraph log only tracks public chains and community diversity.</li>
              </ul>
            </div>
          </SkinPanel>

          <SkinPanel theme={FAX_THEME} className="machine-shadow overflow-hidden rounded-[18px] border border-[#8f8878] bg-[#c8c0ae]">
            <div className="border-b border-[#8f8878] bg-[#b5ad9d] px-5 py-3 text-[10px] font-bold uppercase tracking-[.16em]">The 2222 collection</div>
            <div className="p-5 md:p-8 space-y-4 text-sm leading-relaxed text-[#3e3b34]">
              <p>
                Deep chains can be minted into a fixed-supply <strong>2222 NFT collection</strong> tiered by hop depth.
                The tier names are for clarity: two bookend names with meaning, nine literal hop descriptors in between.
                A collector who sees <strong>7 Hop</strong> knows exactly what they earned.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-[10px] md:text-xs">
                  <thead className="bg-[#b5ad9d] text-[9px] uppercase tracking-wider">
                    <tr>
                      <th className="border border-[#8f8878] p-2">Hops</th>
                      <th className="border border-[#8f8878] p-2">Supply</th>
                      <th className="border border-[#8f8878] p-2">Name</th>
                    </tr>
                  </thead>
                  <tbody className="bg-[#eee8dc]">
                    <tr><td className="border border-[#8f8878] p-2">1</td><td className="border border-[#8f8878] p-2">1,111</td><td className="border border-[#8f8878] p-2">Dial Tone</td></tr>
                    <tr><td className="border border-[#8f8878] p-2">2</td><td className="border border-[#8f8878] p-2">555</td><td className="border border-[#8f8878] p-2">Hop 2</td></tr>
                    <tr><td className="border border-[#8f8878] p-2">3</td><td className="border border-[#8f8878] p-2">246</td><td className="border border-[#8f8878] p-2">Hop 3</td></tr>
                    <tr><td className="border border-[#8f8878] p-2">4</td><td className="border border-[#8f8878] p-2">111</td><td className="border border-[#8f8878] p-2">Hop 4</td></tr>
                    <tr><td className="border border-[#8f8878] p-2">5</td><td className="border border-[#8f8878] p-2">88</td><td className="border border-[#8f8878] p-2">Hop 5</td></tr>
                    <tr><td className="border border-[#8f8878] p-2">6</td><td className="border border-[#8f8878] p-2">44</td><td className="border border-[#8f8878] p-2">Hop 6</td></tr>
                    <tr><td className="border border-[#8f8878] p-2">7</td><td className="border border-[#8f8878] p-2">21</td><td className="border border-[#8f8878] p-2">Hop 7</td></tr>
                    <tr><td className="border border-[#8f8878] p-2">8</td><td className="border border-[#8f8878] p-2">13</td><td className="border border-[#8f8878] p-2">Hop 8</td></tr>
                    <tr><td className="border border-[#8f8878] p-2">9</td><td className="border border-[#8f8878] p-2">12</td><td className="border border-[#8f8878] p-2">Hop 9</td></tr>
                    <tr><td className="border border-[#8f8878] p-2">10</td><td className="border border-[#8f8878] p-2">11</td><td className="border border-[#8f8878] p-2">Hop 10</td></tr>
                    <tr><td className="border border-[#8f8878] p-2">11+</td><td className="border border-[#8f8878] p-2">10</td><td className="border border-[#8f8878] p-2">Dead Letter</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          </SkinPanel>

          <SkinPanel theme={FAX_THEME} className="machine-shadow overflow-hidden rounded-[18px] border border-[#8f8878] bg-[#c8c0ae]">
            <div className="border-b border-[#8f8878] bg-[#b5ad9d] px-5 py-3 text-[10px] font-bold uppercase tracking-[.16em]">Forwarding &amp; minting strategy</div>
            <div className="p-5 md:p-8 space-y-4 text-sm leading-relaxed text-[#3e3b34]">
              <p>
                Forwarding and minting are <strong>not the same action</strong>. You can forward a fax to keep the chain alive
                without minting your current tier, then let the next player mint a rarer tier later — but only if the timer allows it.
              </p>
              <ul className="space-y-2 list-disc pl-4">
                <li><strong>Forward now, mint now</strong> — guaranteed. You claim the current tier and the chain continues.</li>
                <li><strong>Forward without minting</strong> — free for you, but the next player gets the mint. You save the mint fee and bet on reaching a higher, rarer tier.</li>
                <li><strong>Wait for a tier to sell out</strong> — if a low-supply tier is nearly exhausted, holding the fax and hoping it mints out before the 72-hour jam is high-risk, high-reward.</li>
                <li><strong>Same-wallet forwarding is blocked</strong> — you cannot forward a fax directly to another NFT held by the same wallet. Cross-wallet play is still possible, but adds friction.</li>
              </ul>
              <p>
                The 72-hour thermal timer is the enforcer. Waiting is a bet against the clock:
                if the tier does not mint out before the line jams, the chain is dead and the mint opportunity is lost.
                This creates genuine game strategy — late-tier sniping, gifting a friend a rarer mint, and timer tension are all part of play.
              </p>
            </div>
          </SkinPanel>
        </div>

        <footer className="mx-auto mt-6 flex flex-col justify-between gap-2 text-[8px] font-bold uppercase tracking-[.14em] text-[#575347] sm:flex-row">
          <span>Powered by NFTmail.box / ERC-8004 identity</span>
          <Link href="/" className="underline"><ArrowLeft size={10} className="inline" /> Back to office</Link>
        </footer>
      </div>
    </main>
  );
}
