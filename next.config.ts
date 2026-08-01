import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Default é 1MB — pouco pra PDFs da base de conhecimento (addDocument em
      // agentes/actions.ts). Mantenha em sincronia com MAX_KB_FILE_BYTES lá.
      bodySizeLimit: "50mb",
    },
  },
};

export default nextConfig;
