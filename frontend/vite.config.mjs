import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const envDir = resolve(process.cwd(), "..");
  const env = loadEnv(mode, envDir, "");
  const backendUrl = (env.VITE_DEV_BACKEND_URL || "http://localhost:80").replace(/\/+$/, "");

  return {
    envDir,
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/api": {
          changeOrigin: true,
          secure: false,
          target: backendUrl
        },
        "/auth": {
          changeOrigin: true,
          secure: false,
          target: backendUrl
        }
      }
    }
  };
});
