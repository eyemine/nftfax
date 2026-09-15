'use client';

import { FAX_THEME, backgroundStyle, type FaxTheme } from '../lib/theme';

interface SkinPanelProps {
  children: React.ReactNode;
  className?: string;
  /**
   * Classes for the inner content wrapper.
   *
   * The wrapper is the nearest positioned ancestor, so anything absolutely
   * positioned inside a panel resolves against IT, not the panel. By default it
   * is only as tall as its content, which means `bottom-0` children drift as
   * content loads. Pass `flex h-full flex-col` (with `h-full` on the panel) to
   * make it fill the panel so children can anchor to the panel's real edges.
   */
  contentClassName?: string;
  theme?: Pick<FaxTheme, 'backgroundImage' | 'backgroundOpacity'>;
}

/// Themed panel that layers the configured collection artwork behind its
/// children at the configured opacity (default 25%). The artwork is sized to
/// cover the panel and is never interactive, so it will not block clicks.
export function SkinPanel({ children, className = '', contentClassName = '', theme = FAX_THEME }: SkinPanelProps) {
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
      <div className={`relative z-10 ${contentClassName}`}>{children}</div>
    </div>
  );
}
