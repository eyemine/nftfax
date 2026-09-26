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

/// Inline, framework-free diagnostic. The venue tablet has no console, and the
/// first field report was "renders but no data" — which is what a client bundle
/// that fails to parse or execute looks like. React cannot report its own
/// absence, so this runs from the raw HTML: it captures window errors and
/// unhandled rejections, records the user agent, and shows a strip when
/// `?debug=1` is in the URL (or automatically if the bundle has not marked
/// itself hydrated within 8 seconds). The page sets #exhibit-diag-hyd to
/// "hydrated" from its first effect.
const DIAG = `
(function(){
  var q=new URLSearchParams(location.search);var force=q.get('debug')==='1';
  var box=document.getElementById('exhibit-diag');var err=document.getElementById('exhibit-diag-err');
  var hyd=document.getElementById('exhibit-diag-hyd');var ua=document.getElementById('exhibit-diag-ua');
  if(ua)ua.textContent=navigator.userAgent;
  function show(){if(box)box.style.display='block';}
  function log(m){if(err){err.textContent=(err.textContent?err.textContent+'\\n':'')+m;}show();}
  window.addEventListener('error',function(e){log('error: '+(e.message||e.type)+(e.filename?' @ '+e.filename.split('/').pop()+':'+e.lineno:''));},true);
  window.addEventListener('unhandledrejection',function(e){var r=e.reason;log('rejection: '+(r&&r.message?r.message:String(r)));});
  if(force)show();
  setTimeout(function(){if(hyd&&hyd.textContent!=='hydrated'){log('React bundle did not hydrate within 8s — likely unsupported browser version.');}},8000);
})();`;

export default function ExhibitLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <div id="exhibit-diag" style={{ display: 'none', position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 9999, background: '#25251f', color: '#efe8d8', fontFamily: 'ui-monospace, monospace', fontSize: 11, padding: '6px 10px', borderTop: '3px solid #e65b2f' }}>
        <div>js: <span id="exhibit-diag-hyd">not hydrated</span> · ua: <span id="exhibit-diag-ua" /></div>
        <pre id="exhibit-diag-err" style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap', color: '#f0b8a6' }} />
      </div>
      <script dangerouslySetInnerHTML={{ __html: DIAG }} />
    </>
  );
}
