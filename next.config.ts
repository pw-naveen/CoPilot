import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["bullmq", "ioredis", "postgres"],
  outputFileTracingIncludes: { "/**": ["./prompts/**"] },
};

export default config;
