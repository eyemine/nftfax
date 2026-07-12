/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  async rewrites() {
    return [
      {
        source: '/api/tray/:path*',
        destination: 'https://nftmail.box/api/tray/:path*',
      },
    ];
  },
};

module.exports = nextConfig;
