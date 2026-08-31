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
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="grid h-9 w-9 sm:h-10 sm:w-10 place-items-center rounded-sm bg-[#25251f] text-[#efe8d8]">
              <Info size={18} />
            </div>
            <div>
              <h1 className="text-lg sm:text-2xl font-black tracking-[-0.06em] sm:tracking-[-0.08em] leading-[0.95]">FAX CHAIN GAME<span className="text-[#e65b2f]">®</span></h1>
              <p className="text-[8px] sm:text-[9px] font-bold uppercase tracking-[0.2em] sm:tracking-[0.28em] text-[#625e52]">Rules of the chain letter</p>
            </div>
          </div>
          <Link href="/" className="key-shadow border border-[#77705f] bg-[#d8d0bf] px-2 sm:px-3 py-2 text-[9px] sm:text-[10px] font-bold uppercase whitespace-nowrap">Office</Link>
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
                <li><strong>Register</strong> your <strong>@fax</strong> identity in the Rolofax directory before launch.</li>
                <li><strong>Send</strong> a greyscale image to any <code>prefix.tokenId@fax</code> address.</li>
                <li><strong>Forward</strong> public faxes you receive to keep the chain alive and earn +1 send credit.</li>
                <li><strong>Mint</strong> a fax to Base only after forwarding — the collectible is unlocked by participation.</li>
                <li><strong>Save</strong> a fax to Gnosis for permanence — rescues it from the 96-hour decay.</li>
                <li><strong>No loops</strong> — each participant can only appear once in a chain. You cannot forward back to the sender or any previous hop.</li>
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
            <div className="border-b border-[#8f8878] bg-[#b5ad9d] px-5 py-3 text-[10px] font-bold uppercase tracking-[.16em]">Halving timer per hop</div>
            <div className="p-5 md:p-8 space-y-4 text-sm leading-relaxed text-[#3e3b34]">
              <p>
                The 72-hour thermal timer is the base. But with each unminted hop, the timer <strong>halves</strong>:
                the next player gets less time to act. A mint <strong>resets</strong> the timer to 72 hours for the next hop.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-[10px] md:text-xs">
                  <thead className="bg-[#b5ad9d] text-[9px] uppercase tracking-wider">
                    <tr>
                      <th className="border border-[#8f8878] p-2">Hop</th>
                      <th className="border border-[#8f8878] p-2">Timer (no prior mint)</th>
                      <th className="border border-[#8f8878] p-2">After a mint</th>
                    </tr>
                  </thead>
                  <tbody className="bg-[#eee8dc]">
                    <tr><td className="border border-[#8f8878] p-2">1</td><td className="border border-[#8f8878] p-2">72h</td><td className="border border-[#8f8878] p-2">—</td></tr>
                    <tr><td className="border border-[#8f8878] p-2">2</td><td className="border border-[#8f8878] p-2">36h</td><td className="border border-[#8f8878] p-2">72h</td></tr>
                    <tr><td className="border border-[#8f8878] p-2">3</td><td className="border border-[#8f8878] p-2">18h</td><td className="border border-[#8f8878] p-2">72h</td></tr>
                    <tr><td className="border border-[#8f8878] p-2">4</td><td className="border border-[#8f8878] p-2">9h</td><td className="border border-[#8f8878] p-2">72h</td></tr>
                    <tr><td className="border border-[#8f8878] p-2">5</td><td className="border border-[#8f8878] p-2">4.5h</td><td className="border border-[#8f8878] p-2">72h</td></tr>
                    <tr><td className="border border-[#8f8878] p-2">6</td><td className="border border-[#8f8878] p-2">2h</td><td className="border border-[#8f8878] p-2">72h</td></tr>
                    <tr><td className="border border-[#8f8878] p-2">7</td><td className="border border-[#8f8878] p-2">1h</td><td className="border border-[#8f8878] p-2">72h</td></tr>
                    <tr><td className="border border-[#8f8878] p-2">8</td><td className="border border-[#8f8878] p-2">30min</td><td className="border border-[#8f8878] p-2">72h</td></tr>
                    <tr><td className="border border-[#8f8878] p-2">9</td><td className="border border-[#8f8878] p-2">15min</td><td className="border border-[#8f8878] p-2">72h</td></tr>
                    <tr><td className="border border-[#8f8878] p-2">10</td><td className="border border-[#8f8878] p-2">10min</td><td className="border border-[#8f8878] p-2">72h</td></tr>
                    <tr><td className="border border-[#8f8878] p-2">11+</td><td className="border border-[#8f8878] p-2">3min → jammed</td><td className="border border-[#8f8878] p-2">72h</td></tr>
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] uppercase tracking-wider text-[#696457]">Minimum timer is 3 minutes. A mint at any hop resets the next hop to 72 hours.</p>
              <p className="text-[10px] uppercase tracking-wider text-[#696457]"><strong>Mint cap:</strong> once 2,222 faxes have been minted to Base, the halving timer is permanently deactivated. Chains continue indefinitely with no minting pressure — the game becomes a pure forwarding art chain.</p>
            </div>
          </SkinPanel>

          <SkinPanel theme={FAX_THEME} className="machine-shadow overflow-hidden rounded-[18px] border border-[#8f8878] bg-[#c8c0ae]">
            <div className="border-b border-[#8f8878] bg-[#b5ad9d] px-5 py-3 text-[10px] font-bold uppercase tracking-[.16em]">Thermal fade</div>
            <div className="p-5 md:p-8 space-y-4 text-sm leading-relaxed text-[#3e3b34]">
              <p>Public faxes age like thermal paper:</p>
              <ul className="space-y-2 list-disc pl-4">
                <li><strong>0–24h:</strong> crisp, full contrast.</li>
                <li><strong>24–72h:</strong> image fades to grey.</li>
                <li><strong>After 72h:</strong> the line is <strong>JAMMED</strong>. The image turns blank, the chain can no longer be forwarded, and the card is removed from the inbox after a total of 96 hours.</li>
                <li>The sender address stays visible after a jam so someone can start a fresh chain with that player.</li>
              </ul>
            </div>
          </SkinPanel>

          <SkinPanel theme={FAX_THEME} className="machine-shadow overflow-hidden rounded-[18px] border border-[#8f8878] bg-[#c8c0ae]">
            <div className="border-b border-[#8f8878] bg-[#b5ad9d] px-5 py-3 text-[10px] font-bold uppercase tracking-[.16em]">Tray tabs</div>
            <div className="p-5 md:p-8 space-y-4 text-sm leading-relaxed text-[#3e3b34]">
              <ul className="space-y-2 list-disc pl-4">
                <li><strong>In-Tray</strong> — faxes you have received. Shows the thermal-fade countdown and chain link depth. Forward to unlock mint, save to rescue from decay.</li>
                <li><strong>Sent</strong> — faxes you have sent to other players. Shows the recipient, chain position, and a relay countdown. If the recipient hasn't forwarded within 24 hours, a re-route button appears — you can send the fax to a new player to keep the chain alive. The original recipient can still forward, but their mint is disabled.</li>
                <li><strong>Saved</strong> — faxes you have saved to Gnosis. These are permanent and no longer decay.</li>
                <li><strong>Minted</strong> — faxes you have minted to Base as tradeable collectibles. Once the contract is deployed, these will link to OpenSea.</li>
              </ul>
            </div>
          </SkinPanel>

          <SkinPanel theme={FAX_THEME} className="machine-shadow overflow-hidden rounded-[18px] border border-[#8f8878] bg-[#c8c0ae]">
            <div className="border-b border-[#8f8878] bg-[#b5ad9d] px-5 py-3 text-[10px] font-bold uppercase tracking-[.16em]">Relay window — keep the chain alive</div>
            <div className="p-5 md:p-8 space-y-4 text-sm leading-relaxed text-[#3e3b34]">
              <p>If a recipient doesn't forward your fax in time, the chain is at risk of dying. The relay window gives the sender a way to keep it going:</p>
              <ul className="space-y-2 list-disc pl-4">
                <li><strong>0–24h:</strong> Normal — only the recipient can forward and mint. The sender's Sent tray shows a countdown to the relay window.</li>
                <li><strong>24h+:</strong> Relay window opens — the sender can re-route the fax to a new player. Rolofax participants who marked themselves "ready" appear as suggested relay targets.</li>
                <li><strong>After re-route:</strong> The original recipient can still forward the fax (slow lane), but their <strong>mint is disabled</strong>. The re-routed copy is the mintable one (fast lane).</li>
                <li><strong>48h+:</strong> If still no forward, the sender gets a second nudge with additional relay suggestions.</li>
              </ul>
              <p className="text-[10px] uppercase tracking-wider text-[#696457]">This ensures chains don't die from inactive recipients. The sender stays in control of the chain's survival.</p>
            </div>
          </SkinPanel>

          <SkinPanel theme={FAX_THEME} className="machine-shadow overflow-hidden rounded-[18px] border border-[#8f8878] bg-[#c8c0ae]">
            <div className="border-b border-[#8f8878] bg-[#b5ad9d] px-5 py-3 text-[10px] font-bold uppercase tracking-[.16em]">Public vs private</div>
            <div className="p-5 md:p-8 space-y-4 text-sm leading-relaxed text-[#3e3b34]">
              <ul className="space-y-2 list-disc pl-4">
                <li><strong>@fax</strong> transmissions are <strong>public canvases</strong> — anyone can view them at <code>/tray/&#123;id&#125;</code>, with no encryption or private metadata.</li>
                <li><strong>@nftmail.box</strong> transmissions are private and cannot be opened by anyone except the recipient.</li>
                <li>The Rolofax log only tracks public chains and community diversity.</li>
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
              <p className="border-l-4 border-[#e65b2f] bg-[#f5dcc8] p-3 text-[10px] font-bold uppercase tracking-[.12em] text-[#8a3e1e]">
                ⚡ Mint contract launches on Base — 16 August 2026, 12:00 UTC. Chain play and Rolofax registration open 15 August 2026.
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
                <li><strong>Forward now, mint now</strong> — guaranteed. You claim the current tier and the chain continues with a fresh 72h timer.</li>
                <li><strong>Forward without minting</strong> — free for you, but the next player gets less time (timer halves). You save the mint fee and bet on reaching a higher, rarer tier.</li>
                <li><strong>Wait for a tier to sell out</strong> — if a low-supply tier is nearly exhausted, holding the fax and hoping it mints out before the jam is high-risk, high-reward.</li>
                <li><strong>Same-wallet forwarding is blocked</strong> — you cannot forward a fax directly to another NFT held by the same wallet. Cross-wallet play is still possible, but adds friction.</li>
                <li><strong>Loop prevention</strong> — each participant can only appear once in a chain. The worker rejects forwards to any address already in the chain's participant list, including the original sender.</li>
              </ul>
              <p>
                The halving thermal timer is the enforcer. Waiting is a bet against the clock:
                if the tier does not mint out before the line jams, the chain is dead and the mint opportunity is lost.
                This creates genuine game strategy — late-tier sniping, gifting a friend a rarer mint, and timer tension are all part of play.
              </p>
            </div>
          </SkinPanel>

          <SkinPanel theme={FAX_THEME} className="machine-shadow overflow-hidden rounded-[18px] border border-[#8f8878] bg-[#c8c0ae]">
            <div className="border-b border-[#8f8878] bg-[#b5ad9d] px-5 py-3 text-[10px] font-bold uppercase tracking-[.16em]">One mint per NFT, or one per chain?</div>
            <div className="p-5 md:p-8 space-y-3 text-sm leading-relaxed text-[#3e3b34]">
              <p>Mint limits differ by community, because Chonks are verified directly on Base while the other three are verified off-chain against Ethereum:</p>
              <ul className="space-y-2 list-disc pl-4">
                <li><strong>Chonks</strong> — one NFTFAX CHAIN mint <strong>ever</strong> per <code>chonk.1234@fax</code>. Ownership is resolved on-chain against the real Chonk, so a token that has minted once can never mint again.</li>
                <li><strong>POW NFT, Deadfellaz, Normies</strong> — one mint <strong>per chain</strong> per <code>atom/dfz/normie.1234@fax</code>. The same NFT can mint again the next time it starts or joins a different chain-letter.</li>
              </ul>
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
