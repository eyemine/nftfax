/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
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
