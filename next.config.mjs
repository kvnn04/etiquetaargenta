import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Alias '@/*' desde tsconfig (TS ≥6 quitó 'baseUrl'; Next 15.5 lo necesita explícito acá).
  webpack: (config) => {
    config.resolve.alias['@'] = projectRoot;
    return config;
  },
  turbopack: {
    resolveAlias: { '@': projectRoot },
  },
};

export default nextConfig;
