'use client';

import { FAX_THEME, backgroundStyle, type FaxTheme } from '../lib/theme';

interface SkinPanelProps {
  children: React.ReactNode;
  className?: string;
  theme?: Pick<FaxTheme, 'backgroundImage' | 'backgroundOpacity'>;
}

/// Themed panel that layers the configured collection artwork behind its
/// children at the configured opacity (default 25%). The artwork is sized to
/// cover the panel and is never interactive, so it will not block clicks.
export function SkinPanel({ children, className = '', theme = FAX_THEME }: SkinPanelProps) {
  const overlayStyle = backgroundStyle(theme);
  return (
    <div className={`relative overflow-hidden ${className}`}>
      {overlayStyle && (
        <div
          className="pointer-events-none absolute inset-0 -z-0 bg-cover bg-center bg-no-repeat"
          style={overlayStyle}
          aria-hidden="true"
        />
      )}
      <div className="relative z-10">{children}</div>
    </div>
  );
}
