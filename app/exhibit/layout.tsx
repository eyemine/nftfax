import type { Metadata } from 'next';

/// The exhibition dashboard is a venue display, not a page for search engines
/// or social previews. Keep it out of the index so it never competes with the
/// real routes for the brand query.
export const metadata: Metadata = {
  title: 'Live Exhibition',
  robots: { index: false, follow: false },
};

export default function ExhibitLayout({ children }: { children: React.ReactNode }) {
  return children;
}
