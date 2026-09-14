'use client';

/// Mechanical split-flap / odometer counter.
///
/// Each digit is a vertical strip of 0–9 translated to the right position, so
/// changing digits roll rather than swap — matching the fax-machine hardware
/// idiom used across the app.
///
/// The value animates up from zero whenever the target changes, which is
/// deliberate: on the Rolofax radar it runs while the NFT thumbnails are still
/// resolving, so the panel reads as "counting the community" rather than
/// sitting empty.

import { useEffect, useRef, useState } from 'react';

interface OdometerCounterProps {
  /** Target value to count to. */
  value: number;
  /** Number of digit wheels; the value is zero-padded to this width. */
  digits?: number;
  /** Height of one digit window in px. Total height = height + padding + border. */
  height?: number;
  /** Roll duration in ms. */
  duration?: number;
  /** Accessible description of what is being counted. */
  label?: string;
}

/// Ease-out cubic: fast off the mark, settling into the final value, which is
/// what makes a counter feel mechanical rather than linear.
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function OdometerCounter({
  value,
  digits = 6,
  height = 32,
  duration = 900,
  label,
}: OdometerCounterProps) {
  const [display, setDisplay] = useState(0);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const target = Math.max(0, Math.floor(value));

    // Honour reduced-motion: rolling digits are exactly the kind of animation
    // that setting exists for.
    const reduced = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced || target === 0) {
      setDisplay(target);
      return;
    }

    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      setDisplay(Math.round(easeOutCubic(progress) * target));
      if (progress < 1) frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [value, duration]);

  const padded = String(display).padStart(digits, '0').slice(-digits);

  return (
    <div
      className="flex items-center gap-[2px] border border-[#25251f] bg-[#0a0a0a] px-2 py-2"
      style={{ height: height + 20 }}
      role="status"
      aria-live="polite"
      aria-label={label ? `${label}: ${display}` : String(display)}
    >
      {padded.split('').map((char, index) => {
        const digit = Number(char);
        return (
          <span
            key={index}
            className="relative overflow-hidden bg-[#0a0a0a]"
            style={{ height, width: height * 0.62 }}
            aria-hidden="true"
          >
            <span
              className="absolute left-0 top-0 flex w-full flex-col transition-transform duration-300 ease-out"
              style={{ transform: `translateY(-${digit * height}px)` }}
            >
              {Array.from({ length: 10 }, (_, n) => (
                <span
                  key={n}
                  className="flex w-full items-center justify-center font-mono font-bold tabular-nums text-white"
                  style={{ height, fontSize: height * 0.78, lineHeight: `${height}px` }}
                >
                  {n}
                </span>
              ))}
            </span>
          </span>
        );
      })}
    </div>
  );
}

export default OdometerCounter;
