import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const envDir = resolve(__dirname, "..");
  const env = loadEnv(mode, envDir, "");
  const backendUrl = (env.VITE_DEV_BACKEND_URL || "http://localhost:80").replace(/\/+$/, "");

  return {
    cacheDir: ".vite",
    envDir,
    plugins: [react()],
    resolve: {
      alias: {
        "@": resolve(__dirname, "./src")
      }
    },
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
