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

  // Width of the zero pad shrinks as the value gains digits, so the overall
  // field stays `digits` wide.
  const significantDigits = String(Math.max(0, Math.floor(value))).length;
  const padCount = Math.max(0, digits - significantDigits);

  return (
    <div
      className="fax-odometer flex items-center border border-[#252520] bg-[#252520] px-2"
      style={{ height: height + 16 }}
      role="status"
      aria-live="polite"
      aria-label={label ? `${label}: ${value}` : String(value)}
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
