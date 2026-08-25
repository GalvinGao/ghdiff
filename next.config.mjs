/** @type {import('next').NextConfig} */
const nextConfig = {
  // The review surface fetches a patch when it mounts. React strict mode
  // double-invokes effects in development, which would double every upstream
  // GitHub request and burn the rate limit.
  reactStrictMode: false,
  devIndicators: false,
  // @pierre/diffs and @pierre/trees publish subpath exports that Next must
  // follow from server components into client components.
  transpilePackages: ['@pierre/diffs', '@pierre/trees'],
};

export default nextConfig;
