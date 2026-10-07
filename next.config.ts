import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["bullmq", "ioredis", "postgres"],
  outputFileTracingIncludes: { "/**": ["./prompts/**"] },
};

export default config;
