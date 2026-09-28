/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  images: {
    // Image URLs carry ?v=<bitmapRepairedAt> so a bitmap repaired in place is a
    // new URL to every cache. The optimizer rejects local URLs with a query
    // string unless a localPattern allows it - without this, every versioned
    // tile 400'd with '"url" parameter is not allowed' (token #3's thumbnail).
    // `search` omitted = any query string (it is an exact-string match when set,
    // no wildcards), which is what a version parameter needs.
    localPatterns: [
      { pathname: '/api/tray/**' },
      { pathname: '/api/metadata/**' },
    ],
  },
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  async rewrites() {
    return [
      {
        source: '/api/telegraph/:path*',
        destination: 'https://nftmail.box/api/telegraph/:path*',
      },
    ];
  },
};

module.exports = nextConfig;
