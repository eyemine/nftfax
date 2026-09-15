'use client';

/// Mechanical rolling counter, built on HubSpot's odometer.js.
///
/// https://github.hubspot.com/odometer/
///
/// Two things worth knowing about the library:
///
///  1. It is DOM-driven — it rewrites the element's inner HTML and animates via
///     CSS transitions — so it must only run in the browser. It is therefore
///     imported dynamically inside an effect rather than at module scope, which
///     would break server rendering.
///
///  2. Its bundled theme CSS contains IE7 star-hacks that modern PostCSS
///     rejects, so the build fails on `import 'odometer/themes/...'`. The same
///     rules live in ./odometer-theme.css with the hacks removed.
///
///  3. It has NO zero-padding option. Its digit count follows the magnitude of
///     the value, so a count of 9 renders one wheel, not `000009`. The static
///     leading zeros are rendered alongside it in the same typeface, and the
///     odometer handles the significant digits. They roll; the pad does not.
///     That is the closest the library gets to the six-digit brief.

import { useEffect, useRef, useState } from 'react';
import './odometer-theme.css';

interface OdometerCounterProps {
  /** Target value to count to. */
  value: number;
  /** Total width in digits; the value is zero-padded up to this. */
  digits?: number;
  /** Height of the digit window in px. */
  height?: number;
  /** Accessible description of what is being counted. */
  label?: string;
}

export function OdometerCounter({
  value,
  digits = 6,
  height = 32,
  label,
}: OdometerCounterProps) {
  const elRef = useRef<HTMLSpanElement>(null);
  const odometerRef = useRef<{ update: (n: number) => void } | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const mod = await import('odometer');
      if (cancelled || !elRef.current) return;
      const Odometer = (mod.default ?? mod) as new (opts: {
        el: HTMLElement;
        value: number;
        duration?: number;
        format?: string;
      }) => { update: (n: number) => void };

      // Start from zero so the first render counts up rather than snapping to
      // the total — the radar populates while thumbnails are still resolving.
      odometerRef.current = new Odometer({
        el: elRef.current,
        value: 0,
        duration: 900,
        format: 'd',
      });
      setReady(true);
    })();

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!ready || !odometerRef.current) return;
    odometerRef.current.update(Math.max(0, Math.floor(value)));
  }, [ready, value]);

  // Zero pad fills the field to `digits`. Derived from the target value, which
  // is stable for the duration of a roll — deriving it from odometer's
  // in-flight display was what made the digit count flicker.
  const safeValue = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  const padCount = Math.max(0, digits - String(safeValue).length);

  // The field is a FIXED width for `digits` glyphs, right-aligned.
  //
  // odometer's own width tracks the magnitude of its value and it briefly
  // renders extra markup mid-transition, which made the box grow to a seventh
  // digit and then snap back. Reserving the width up front means nothing
  // internal to the library can resize it.
  const glyphWidth = height * 0.62;

  return (
    <div
      className="fax-odometer flex items-center justify-end overflow-hidden border border-[#252520] bg-[#252520] px-2"
      style={{ height: height + 16, width: digits * glyphWidth + 16 }}
      role="status"
      aria-live="polite"
      aria-label={label ? `${label}: ${safeValue}` : String(safeValue)}
    >
      {padCount > 0 && (
        <span
          className="font-mono font-bold tabular-nums text-[#c7c0b0]"
          style={{ fontSize: height * 0.78, lineHeight: `${height}px` }}
          aria-hidden="true"
        >
          {'0'.repeat(padCount)}
        </span>
      )}
      <span
        ref={elRef}
        className="font-mono font-bold tabular-nums text-[#c7c0b0]"
        style={{ fontSize: height * 0.78, lineHeight: `${height}px` }}
        aria-hidden="true"
      />
    </div>
  );
}

export default OdometerCounter;
