import { fileURLToPath } from "node:url";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { build } from "vite";

const frontendRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

await build({
  root: frontendRoot,
  envDir: path.resolve(frontendRoot, ".."),
  configFile: false,
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("react") || id.includes("scheduler")) return "vendor-react";
          if (id.includes("lucide-react")) return "vendor-icons";
          if (id.includes("framer-motion")) return "vendor-animation";
          if (id.includes("axios") || id.includes("socket.io-client") || id.includes("engine.io-client")) return "vendor-network";
          return "vendor";
        }
      }
    }
  }
});
