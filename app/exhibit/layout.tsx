import type { Metadata, Viewport } from 'next';

/// The exhibition dashboard is a venue display, not a page for search engines
/// or social previews. Keep it out of the index so it never competes with the
/// real routes for the brand query.
export const metadata: Metadata = {
  title: 'Live Exhibition',
  robots: { index: false, follow: false },
  // iPad Safari has no Fullscreen API for page content. "Add to Home Screen"
  // launches this as a standalone web app with no browser chrome, which is the
  // kiosk mode. Android Chrome gets the same via "Add to Home screen" or the
  // in-page fullscreen button.
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'FAX CHAIN Live' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // A gallery visitor brushing the glass must not zoom the display.
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#25251f',
};

export default function ExhibitLayout({ children }: { children: React.ReactNode }) {
  return children;
}
