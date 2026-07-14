#!/usr/bin/env python3
"""Surgical patch: make getTrayDocument return `to` when authenticated.
Idempotent + verifies exactly one replacement."""
import sys

PATH = "/opt/ghostagent/bun-worker/index.ts"

OLD = """          const record = JSON.parse(raw);
          return corsify(Response.json({
            id: record.id,
            from: record.from,
            format: record.format,
            dataBase64: record.dataBase64,
            createdAt: record.createdAt,
            chainTrayId: record.chainTrayId || null,
            chainDepth: record.chainDepth || 1,
          }), request);
        }"""

NEW = """          const record = JSON.parse(raw);
          const trayAuthed = !!env.WEBHOOK_SECRET &&
            ((email as any).secret || request.headers.get('X-Webhook-Secret') || request.headers.get('X-Worker-Secret') || '') === env.WEBHOOK_SECRET;
          const trayResp: Record<string, any> = {
            id: record.id,
            from: record.from,
            format: record.format,
            dataBase64: record.dataBase64,
            createdAt: record.createdAt,
            chainTrayId: record.chainTrayId || null,
            chainDepth: record.chainDepth || 1,
          };
          // `to` is only exposed to authenticated backend callers (the send/forward
          // route needs it to verify the forwarder was the recipient). It must never
          // leak on the public /tray/{id} viewer.
          if (trayAuthed) trayResp.to = record.to;
          return corsify(Response.json(trayResp), request);
        }"""

with open(PATH, "r") as f:
    src = f.read()

if "const trayAuthed" in src:
    print("ALREADY_PATCHED")
    sys.exit(0)

count = src.count(OLD)
if count != 1:
    print(f"ERROR: expected exactly 1 match, found {count}")
    sys.exit(1)

src = src.replace(OLD, NEW)
with open(PATH, "w") as f:
    f.write(src)
print("PATCHED_OK")
