#!/usr/bin/env bash
# Bundle everything the exhibit stack needs onto one tarball you can carry to a
# new Mac: printer daemon, both camera daemons, launchd agents, env (secrets!),
# and the CUPS driver pieces for the BY P800.
#
#   scripts/exhibit-migrate-pack.sh            → ./nftfax-exhibit-migrate.tar.gz
#
# The tarball contains install.sh — see INSTALL.md inside for the new-Mac steps.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"          # nftfax/scripts
REPO="$(dirname "$HERE")"                     # nftfax
OUT="$PWD/nftfax-exhibit-migrate.tar.gz"
WORK=$(mktemp -d -t nftfax-migrate)
trap 'rm -rf "$WORK"' EXIT

B="$WORK/nftfax-exhibit"
mkdir -p "$B"/{app,env,launchd,cups}

# --- app: the two daemons + a minimal package.json for sharp -------------------
cp "$REPO/scripts/exhibit-printer.mjs" "$B/app/"
cp "$REPO/scripts/exhibit-cam.sh"      "$B/app/"
chmod +x "$B/app/exhibit-cam.sh"
SHARP_VER=$(node -e "console.log(require('sharp/package.json').version)" 2>/dev/null || true)
[ -z "$SHARP_VER" ] && SHARP_VER="0.34.5"
cat > "$B/app/package.json" <<EOF
{ "name": "nftfax-exhibit", "private": true, "type": "module",
  "dependencies": { "sharp": "$SHARP_VER" } }
EOF

# --- env + launchd ------------------------------------------------------------
cp "$HOME/.config/nftfax/exhibit-printer.env" "$B/env/" 2>/dev/null || {
  echo "!! ~/.config/nftfax/exhibit-printer.env not found"; exit 1; }
for a in exhibit-printer exhibit-cam exhibit-cam2; do
  cp "$HOME/Library/LaunchAgents/app.nftfax.$a.plist" "$B/launchd/" 2>/dev/null \
    || echo "  (warn) $a plist missing — skipped"
done

# --- CUPS driver (needs sudo to read; run with sudo or copy manually) ----------
if sudo -n true 2>/dev/null || [ -r /etc/cups/ppd/BY_P800.ppd ]; then
  cp /etc/cups/ppd/BY_P800.ppd "$B/cups/" 2>/dev/null || sudo cp /etc/cups/ppd/BY_P800.ppd "$B/cups/"
  cp /usr/libexec/cups/filter/km-raster-filter "$B/cups/" 2>/dev/null || sudo cp /usr/libexec/cups/filter/km-raster-filter "$B/cups/"
  sudo chown -R "$(id -u):$(id -g)" "$B/cups" 2>/dev/null || true
else
  echo "  (warn) no sudo — copy cups pieces manually:"
  echo "         /etc/cups/ppd/BY_P800.ppd and /usr/libexec/cups/filter/km-raster-filter"
fi

# --- install.sh for the new Mac ------------------------------------------------
cat > "$B/install.sh" <<'INSTALL'
#!/usr/bin/env bash
# Install the nftfax exhibit stack on the new Mac. Run from the unpacked dir:
#   tar xzf nftfax-exhibit-migrate.tar.gz && cd nftfax-exhibit && ./install.sh
set -euo pipefail
B="$(cd "$(dirname "$0")" && pwd)"
APP="$HOME/nftfax-exhibit"                    # where the daemons live

echo "== deps =="
SW_VERS=$(sw_vers -productVersion)
echo "macOS $SW_VERS"
case "$SW_VERS" in
  10.*|11.*|12.*)
    echo
    echo "NOTE: macOS 12 Monterey is no longer supported by Homebrew upstream."
    echo "'brew install' may fall back to building from source (slow) or fail."
    echo "Easier fallbacks if it does:"
    echo "  node   → install the LTS pkg from nodejs.org (works on macOS 12)"
    echo "  ffmpeg → static build from evermeet.cx/ffmpeg (x86_64, no deps)"
    echo "Make sure 'node' and 'ffmpeg' are on PATH, then re-run this script."
    ;;
esac
command -v node   >/dev/null 2>&1 || brew install node   || { echo "node missing — see note above"; exit 1; }
command -v ffmpeg >/dev/null 2>&1 || brew install ffmpeg || { echo "ffmpeg missing — see note above"; exit 1; }
command -v node >/dev/null && command -v ffmpeg >/dev/null || exit 1

echo "== app =="
mkdir -p "$APP" "$HOME/Library/Logs/nftfax" "$HOME/.config/nftfax"
cp "$B/app/"* "$APP/"
( cd "$APP" && npm install --omit=dev )

echo "== env =="
cp "$B/env/exhibit-printer.env" "$HOME/.config/nftfax/"
chmod 600 "$HOME/.config/nftfax/exhibit-printer.env"

echo "== launchd agents =="
NODE_BIN="$(command -v node)"
for a in exhibit-printer exhibit-cam exhibit-cam2; do
  SRC="$B/launchd/app.nftfax.$a.plist"
  DST="$HOME/Library/LaunchAgents/app.nftfax.$a.plist"
  [ -f "$SRC" ] || continue
  # Rewrite the repo path + node binary for this machine.
  sed -e "s|/Users/richieogorman/CascadeProjects/nftfax|$APP|g" \
      -e "s|/usr/local/bin/node|$NODE_BIN|g" \
      -e "s|/opt/homebrew/bin/node|$NODE_BIN|g" \
      -e "s|scripts/exhibit-printer.mjs|exhibit-printer.mjs|g" \
      -e "s|scripts/exhibit-cam.sh|exhibit-cam.sh|g" \
      "$SRC" > "$DST"
done

echo "== CUPS printer =="
if [ -f "$B/cups/BY_P800.ppd" ]; then
  sudo cp "$B/cups/km-raster-filter" /usr/libexec/cups/filter/
  # Tarballs carry quarantine xattrs; CUPS (as _lp) can't exec a quarantined
  # filter and fails jobs silently.
  sudo xattr -d com.apple.quarantine /usr/libexec/cups/filter/km-raster-filter 2>/dev/null || true
  sudo chmod 755 /usr/libexec/cups/filter/km-raster-filter
  sudo chown root:wheel /usr/libexec/cups/filter/km-raster-filter
  # -P the bundle's PPD via /tmp, NOT /etc/cups/ppd/ — if a generic queue was
  # created earlier (e.g. via System Settings), /etc/cups/ppd/BY_P800.ppd is
  # the generic one and -P on it just reinstalls Generic.
  cp "$B/cups/BY_P800.ppd" /tmp/BY_P800-install.ppd
  # A stale generic queue must go, not be skipped — check it's actually ours.
  if lpstat -p BY_P800 >/dev/null 2>&1 && ! grep -q km-raster-filter /etc/cups/ppd/BY_P800.ppd 2>/dev/null; then
    echo "  existing BY_P800 queue uses a generic PPD — recreating"
    sudo lpadmin -x BY_P800
  fi
  if lpstat -p BY_P800 >/dev/null 2>&1; then
    echo "  queue BY_P800 already exists — leaving it"
  else
    echo "  connect the BY P800 now, then press Enter"; read -r _
    URI=$(lpinfo -v | grep -i "usb.*P800\|usb.*BY" | awk '{print $2}' | head -1)
    [ -z "$URI" ] && URI="usb://BY/P800?serial=BY80121120007"
    sudo lpadmin -p BY_P800 -E -v "$URI" -P /tmp/BY_P800-install.ppd
    echo "  created queue BY_P800 → $URI"
  fi
  grep -q km-raster-filter /etc/cups/ppd/BY_P800.ppd 2>/dev/null \
    && echo "  PPD ok (km-raster-filter)" \
    || echo "  !! /etc/cups/ppd/BY_P800.ppd is still not the BY P800 driver"
fi

echo
echo "Done. Before starting here, on the OLD Mac run:"
echo "  for a in exhibit-printer exhibit-cam exhibit-cam2; do"
echo "    launchctl unload ~/Library/LaunchAgents/app.nftfax.\$a.plist; done"
echo
echo "Then load the agents on this Mac:"
echo "  for a in exhibit-printer exhibit-cam exhibit-cam2; do"
echo "    launchctl load ~/Library/LaunchAgents/app.nftfax.\$a.plist; done"
echo "Logs: ~/Library/Logs/nftfax/"
INSTALL
chmod +x "$B/install.sh"

cat > "$B/INSTALL.md" <<'MD'
# nftfax exhibit — migration bundle

Contains: printer daemon + 2 camera daemons, launchd agents, env (secrets),
CUPS driver for the BY P800.

On the new Mac:
  tar xzf nftfax-exhibit-migrate.tar.gz
  cd nftfax-exhibit && ./install.sh

The installer installs node/ffmpeg via Homebrew, unpacks the app to
~/nftfax-exhibit, installs the CUPS driver + BY_P800 queue (plug the printer
in when prompted), and rewrites the launchd agents for this Mac's paths.

Healthchecks need nothing here — the server pings healthchecks.io based on
the daemon's reported printer status. Keep-alive is KEEPALIVE_MIN in the env.
MD

tar -czf "$OUT" -C "$WORK" nftfax-exhibit
echo "→ $OUT"
echo "  NOTE: this tarball CONTAINS SECRETS (print key, cam publish password)."
echo "  Move it over USB/AirDrop, not email or cloud sync."
