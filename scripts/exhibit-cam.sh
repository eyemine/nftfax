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
#      CAM_RELAY (default 46.225.158.75)
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
URL="rtsp://publisher:${CAM_PUBLISH_PASS}@${RELAY}:8554/printer"

# A print job on the same USB 2 hub can starve the camera; the capture then
# stalls and ffmpeg sits forever producing nothing, while the relay drops the
# stream and every viewer gets 404. -rw_timeout / -timeout make ffmpeg give up on
# a dead input or socket, and the progress watchdog below kills it if the frame
# counter stops advancing for 15 s. The loop then reconnects.
while true; do
  echo "$(date '+%H:%M:%S') publishing ${DEV} ${SIZE}@${FPS} → ${RELAY}/printer"
  PROG=$(mktemp -t nftfax-cam-progress)
  ffmpeg -hide_banner -loglevel warning -nostats -progress "$PROG" \
    -f avfoundation -framerate "$FPS" -video_size "$SIZE" -pixel_format "${CAM_PIXFMT:-uyvy422}" -i "${DEV}:none" \
    -an \
    -c:v h264_videotoolbox -realtime 1 -profile:v main -bf 0 \
    -b:v "${KBPS}k" -maxrate "${KBPS}k" -bufsize "$((KBPS * 2))k" \
    -g 30 -pix_fmt yuv420p \
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
  rm -f "$PROG"
  echo "$(date '+%H:%M:%S') ffmpeg exited ($RC) — reconnecting in 3 s"
  sleep 3
done
