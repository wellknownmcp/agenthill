/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The engine ships as TypeScript source (it is the rules, not a build artefact).
  // The web reads its constants so a bound is never written down twice.
  transpilePackages: ["@agenthill/engine"],
  poweredByHeader: false,
  async rewrites() {
    return [{ source: "/@:slug", destination: "/p/:slug" }];
  },
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "X-Content-Type-Options", value: "nosniff" }, { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" }] }];
  },
};
export default nextConfig;
