# Exhibition dashboard — `/exhibit`

Venue display for a physical thermal printer housed in a replica fax machine. Live at
`https://nftfax.app/exhibit`. Source: `app/exhibit/page.tsx`.

## What it does

Polls the public leaderboard. On each **new FAX CHAIN mint** it:

1. features the minted fax full-size (iframe of `/tray/<id>`, highlighted orange while printing),
2. shows an "Incoming transmission · printing" overlay for 14 s,
3. **POSTs a JSON event to your middleware** (if `?middleware=` is set), which drives the
   Bluetooth printer and the handshake audio.

Prints fire for **mints only**. Sends are not public data (they live in private trays), so the
only feed of chain activity a venue display can legitimately read is the on-chain mint log.

## Why it is a route on nftfax.app and not a local HTML file

Both `nftfax.app` and `nftmail.box` send `X-Frame-Options: SAMEORIGIN`. A page served from
`file://` or `localhost` **cannot iframe a tray permalink** — the browser refuses. Serving the
dashboard from the same origin as the trays is the only clean way to embed the fax.

That also means the webcam works (getUserMedia needs HTTPS), and the leaderboard calls are
same-origin so no CORS is involved on the read side.

## Device compatibility — check this first

The page is laid out for a landscape tablet (1024×768 through 1366×1024). It fits with no
scrolling; portrait stacks the two columns as a fallback.

**Load `/exhibit?debug=1` on the device before anything else.** A strip at the bottom reports
`js: hydrated` once the React bundle is running. If it instead reads *"React bundle did not
hydrate"*, that browser cannot execute the current Next.js output and the device is unusable
for this — the shell renders but no data, camera, or print events will ever appear.

That was the outcome on the first iPad tried: its Safari was too old. **A recent Android
tablet running Chrome is the known-good target.** A current-generation iPad on an up-to-date
iPadOS should also work, but verify with the debug strip rather than assuming.

## Setting up an Android tablet (landscape, kiosk)

1. **Open in Chrome**, allow the camera when prompted. Confirm `js: hydrated` with `?debug=1`.
2. **Tap the fullscreen button** (bottom-centre) — Android has the Fullscreen API. Or
   Chrome menu → **Add to Home screen** and launch from the icon for a chrome-less window.
3. **Settings → Security → App pinning** (name varies by vendor: "Screen pinning", "Pin
   windows"). Pin Chrome; the tablet is locked to it until unpinned with the lock code.
4. **Settings → Display → Screen timeout → longest / never**, and keep it on power.

## Setting up an iPad (only if the debug strip says hydrated)

1. **Open in Safari** at the URL below, allow the camera when prompted.
2. **Share → Add to Home Screen.** Launching from that icon runs it as a standalone web app
   with no Safari toolbar — this is the only full-screen mode on iPad, since Safari has no
   Fullscreen API for page content. The status bar goes translucent-black to match.
3. **Settings → Accessibility → Guided Access → on**, set a passcode. Open the Home Screen
   app, triple-click the top button, tap **Start**. The iPad is now locked to the display:
   no home gesture, no notifications, no accidental exits. Triple-click + passcode to end.
4. **Disable Auto-Lock** (Settings → Display & Brightness → Auto-Lock → Never) and keep it on
   power. Guided Access does not stop the screen sleeping.

Camera permission granted in Safari carries over to the Home Screen app. If the PIP shows
"camera API unavailable", the page was opened over plain http — it must be https.

On an Android tablet the same URL works in Chrome; the on-page fullscreen button appears
there (Android has the Fullscreen API), and Chrome's own "Add to Home screen" plus Android's
screen-pinning give the equivalent kiosk.

## Opening it at the venue

```
https://nftfax.app/exhibit?middleware=http://localhost:8787/print&cam=1&pip=br
```

| Param | Default | Meaning |
|---|---|---|
| `middleware=<url>` | none | POST every mint event here. Without it the dashboard is display-only. |
| `poll=<s>` | 8 | Leaderboard poll interval. Do not go below ~5; the leaderboard route scans logs. |
| `cam=0` | on | Disable the webcam PIP. |
| `pip=br\|bl\|tr\|tl` | `br` | Which corner the webcam sits in. |
| `test=1` | off | Fire one print event for the latest mint on load — for soundcheck. |

Touch controls sit bottom-centre (camera toggle, **test print**, and fullscreen where the
device supports it). With a keyboard attached: **F** fullscreen · **C** camera · **T** test
print · **Esc** dismiss the overlay.

## The middleware contract

The dashboard is an HTTPS page. Chrome and Firefox treat `http://localhost` as a secure
context, so the POST is permitted — **but your server must answer CORS**, or the browser drops
the response and the dashboard logs "middleware unreachable".

Required response headers:

```
Access-Control-Allow-Origin: https://nftfax.app
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

Answer the `OPTIONS` preflight with 204 and those headers. Then on `POST /print` you receive:

```json
{
  "event": "mint",
  "at": "2026-09-25T02:14:09.120Z",
  "tokenId": 21,
  "trayId": "d4172ce5fced",
  "handle": "atom.648@fax",
  "collection": "POW NFT",
  "collectionKey": "pow",
  "minter": "0x4b35237538fe70863d7e7bbbc83f3f621c6c4fb9",
  "minterEns": "rgbanksy.eth",
  "chainDepth": 3,
  "tier": "Hop 3",
  "imageUrl": "https://nftfax.app/api/metadata/21/image",
  "trayUrl":  "https://nftfax.app/tray/d4172ce5fced"
}
```

**`imageUrl` is what you print.** It returns the token's artwork as PNG bytes — the same
1-bit-style bitmap the fax carries, which is exactly what a thermal head wants. Fetch it,
dither/threshold to the printer's width (typically 384 px for 58 mm, 576 px for 80 mm), print.
It is cached for a day and immutable once minted, so re-fetching is cheap.

Minimal Node sketch:

```js
import http from 'node:http';
const CORS = { 'Access-Control-Allow-Origin': 'https://nftfax.app', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return res.writeHead(204, CORS).end();
  if (req.method !== 'POST') return res.writeHead(405, CORS).end();
  let body = ''; for await (const c of req) body += c;
  const ev = JSON.parse(body);
  res.writeHead(202, CORS).end();                 // ack fast; print async
  playFaxHandshake();                             // -> Bluetooth speaker
  const png = Buffer.from(await (await fetch(ev.imageUrl)).arrayBuffer());
  await printBitmap(png, { header: `T/#${ev.trayId.toUpperCase()}  FAX CHAIN #${ev.tokenId}`, footer: `${ev.minterEns ?? ev.minter}  ·  ${ev.handle}  ·  hop ${ev.chainDepth}` });
}).listen(8787);
```

Ack with 2xx **before** printing — the dashboard only needs to know you received it, and a
slow printer should not hold the browser's fetch open.

### Alternative: let the middleware poll instead

If you would rather the printer not depend on a browser tab staying alive, the middleware
can watch the chain itself and the dashboard becomes purely visual:

```
GET https://nftfax.app/api/tray/leaderboard?pageSize=1
→ mints[0].tokenId
```

`mints` is sorted newest-first. Poll every ~8 s; when `tokenId` exceeds the last one you saw,
build the same payload from that entry and print. `imageUrl` is `/api/metadata/<tokenId>/image`.
Both approaches can run at once — the dashboard POST and your own poll — if you dedupe on
`tokenId`.

## Behaviour worth knowing before the doors open

- **First load never prints.** It shows the latest mint but treats history as seen, so
  opening the page does not fire twenty prints. Use `?test=1` or **T** for the soundcheck.
- **A burst of mints prints them all,** oldest first, 4 s apart, rather than skipping to the
  newest.
- **Decayed trays fall back to artwork.** Tray permalinks expire after eight days. If a
  featured fax's tray is gone, the frame shows `/api/metadata/<id>/image` instead of a 404.
- **Offline is visible.** If the leaderboard fails, the header badge turns red "offline" and
  the last good data stays on screen. It recovers on the next successful poll.
- **The webcam is muted, autoplay, no audio track requested** — so it will not fight the
  fax handshake on the speaker.
- **Nothing here spends credits or touches wallets.** It is read-only against public data.

## Running a soundcheck

1. Start the middleware. `curl -X POST localhost:8787/print -d '{}'` should not crash it.
2. Open the dashboard with `?middleware=…&test=1`. One print event fires for the latest mint.
3. The "Print events" log bottom-right shows `sent to printer` (2xx), `middleware unreachable`
   (CORS or connection failure), or `display only` (no `middleware=` param).
4. Tap the printer button (or **T**) to repeat as many times as the printer needs.
