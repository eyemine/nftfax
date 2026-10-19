#!/usr/bin/env bash
# Publish the printer webcam to the MediaMTX relay on Hetzner. Runs on the Mac
# beside the fax machine. The tablet plays it with
#   /exhibit?cam=whep:https://nftfax.app/cam/printer/whep
#
#   set -a; source ~/.config/nftfax/exhibit-printer.env; set +a
#   scripts/exhibit-cam.sh
#
# Env: CAM_PUBLISH_PASS (required), CAM_DEVICE (default QDQHD2KCM),
#      CAM_SIZE (default 1280x720), CAM_FPS (default 30), CAM_KBPS (default 2500),
#      CAM_RELAY (default 46.225.158.75), CAM_PATH (relay path, default printer),
#      CAM_VF / CAM_VF_<path> (optional ffmpeg -vf filter, e.g.
#      CAM_VF_printer=hflip,vflip rotates camera 1 by 180°)
#
# Two cameras = two instances of this script with different CAM_DEVICE/CAM_PATH
# (the launchd agent app.nftfax.exhibit-cam2 runs the second). The tablet shows
# whichever the operator picks with the 1 / 2 buttons.
#
# Notes for WebRTC: H.264 with no B-frames and a ~2 s keyframe interval so a
# viewer joining mid-stream gets a picture quickly. The output rate is whatever
# the camera delivers: through a USB 2 hub, uncompressed 720p arrives at ~15 fps
# (bandwidth), and forcing 30 just duplicates frames. Plugging the camera
# straight into the Mac gets the full 30. Audio is deliberately not
# sent - the handshake plays on the tablet; a delayed copy would smear it.
# Reconnects forever: a Wi-Fi blip must not leave the wall frozen all evening.
set -u
: "${CAM_PUBLISH_PASS:?set CAM_PUBLISH_PASS}"
DEV="${CAM_DEVICE:-QDQHD2KCM}"
SIZE="${CAM_SIZE:-1280x720}"
# avfoundation wants the device's EXACT mode; this camera reports 30.00003, not 30.
FPS="${CAM_FPS:-30.00003}"
KBPS="${CAM_KBPS:-2500}"
RELAY="${CAM_RELAY:-46.225.158.75}"
CAM_PATH="${CAM_PATH:-printer}"
URL="rtsp://publisher:${CAM_PUBLISH_PASS}@${RELAY}:8554/${CAM_PATH}"
# Optional ffmpeg video filter, e.g. CAM_VF=hflip,vflip turns an upside-down
# camera the right way up for every viewer (exhibit page and OgarVerse alike).
# Both cameras source the same env file, so CAM_VF_<path> (CAM_VF_printer,
# CAM_VF_wide) targets one camera and takes precedence over CAM_VF.
PV="CAM_VF_${CAM_PATH}"
CAM_VF="${!PV:-${CAM_VF:-}}"
VF=()
[ -n "$CAM_VF" ] && VF=(-vf "$CAM_VF")
# ~2 s keyframe interval whatever the frame rate.
GOP=$(printf '%.0f' "$(echo "${FPS} * 2" | bc -l)")

# One publisher per relay path. Two instances (a stray applet, a manual run, a
# relaunch while the old one hangs) kick each other off MediaMTX every few
# seconds and the wall flickers between "live" and "disconnected". The newest
# instance wins: it terminates the previous one and any orphaned ffmpeg still
# pushing to this path, and an instance that loses the lock exits.
LOCK="${TMPDIR:-/tmp}/nftfax-cam-${CAM_PATH}.pid"
OLD=$(cat "$LOCK" 2>/dev/null)
[ -n "$OLD" ] && [ "$OLD" != "$$" ] && kill "$OLD" 2>/dev/null
echo $$ > "$LOCK"
FF=""
trap '[ -n "$FF" ] && kill "$FF" 2>/dev/null; exit 0' TERM INT

# A print job on the same USB 2 hub can starve the camera; the capture then
# stalls and ffmpeg sits forever producing nothing, while the relay drops the
# stream and every viewer gets 404. -rw_timeout / -timeout make ffmpeg give up on
# a dead input or socket, and the progress watchdog below kills it if the frame
# counter stops advancing for 15 s. The loop then reconnects.
while true; do
  [ "$(cat "$LOCK" 2>/dev/null)" = "$$" ] || { echo "$(date '+%H:%M:%S') another publisher took ${CAM_PATH} — exiting"; exit 0; }
  pkill -f ":8554/${CAM_PATH}\$" 2>/dev/null && sleep 1
  echo "$(date '+%H:%M:%S') publishing ${DEV} ${SIZE}@${FPS} ${KBPS}k ${CAM_VF:-} → ${RELAY}/${CAM_PATH}"
  PROG=$(mktemp -t nftfax-cam-progress)
  ffmpeg -hide_banner -loglevel warning -nostats -progress "$PROG" \
    -f avfoundation -framerate "$FPS" -video_size "$SIZE" -pixel_format "${CAM_PIXFMT:-uyvy422}" -i "${DEV}:none" \
    -an ${VF[@]+"${VF[@]}"} \
    -c:v h264_videotoolbox -realtime 1 -profile:v main -bf 0 \
    -b:v "${KBPS}k" -maxrate "${KBPS}k" -bufsize "$((KBPS * 2))k" \
    -g "$GOP" -pix_fmt yuv420p \
    -rw_timeout 10000000 \
    -f rtsp -rtsp_transport tcp "$URL" &
  FF=$!
  LAST=""; STALL=0
  while kill -0 "$FF" 2>/dev/null; do
    sleep 5
    CUR=$(grep -E "^frame=" "$PROG" 2>/dev/null | tail -1)
    if [ -n "$CUR" ] && [ "$CUR" = "$LAST" ]; then STALL=$((STALL + 5)); else STALL=0; fi
    LAST="$CUR"
    if [ "$STALL" -ge 15 ]; then echo "$(date '+%H:%M:%S') capture stalled (${CUR:-no frames}) — restarting ffmpeg"; kill "$FF" 2>/dev/null; sleep 1; kill -9 "$FF" 2>/dev/null; break; fi
  done
  wait "$FF" 2>/dev/null; RC=$?
  FF=""
  rm -f "$PROG"
  echo "$(date '+%H:%M:%S') ffmpeg exited ($RC) — reconnecting in 3 s"
  sleep 3
done
