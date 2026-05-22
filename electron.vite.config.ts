import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { createReadStream, cpSync, existsSync, mkdirSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { Plugin } from "vite";

const rendererAssetsDir = resolve("assets");
const rendererOutAssetsDir = resolve("out/renderer/assets");

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: "src/main/index.ts"
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: "src/main/preload.ts",
        output: {
          format: "cjs",
          entryFileNames: "preload.cjs"
        }
      }
    }
  },
  renderer: {
    plugins: [react(), copyRendererAssetsPlugin()],
    build: {
      rollupOptions: {
        input: "src/renderer/index.html"
      }
    }
  }
});

// 让根目录 assets 在 dev 和 build 中都能通过 /assets/... 访问.
function copyRendererAssetsPlugin(): Plugin {
  return {
    name: "aiko-renderer-assets",
    configureServer(server) {
      server.middlewares.use("/assets", (request, response, next) => {
        const requestPath = decodeURIComponent((request.url ?? "").split("?")[0] ?? "").replace(/^\/+/, "");
        const filePath = resolve(rendererAssetsDir, requestPath);
        const relativeFilePath = relative(rendererAssetsDir, filePath);
        if (relativeFilePath.startsWith("..") || isAbsolute(relativeFilePath)) {
          response.statusCode = 403;
          response.end();
          return;
        }

        if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
          next();
          return;
        }

        response.setHeader("Content-Type", "application/octet-stream");
        createReadStream(filePath).pipe(response);
      });
    },
    closeBundle() {
      if (!existsSync(rendererAssetsDir)) return;
      mkdirSync(rendererOutAssetsDir, { recursive: true });
      cpSync(rendererAssetsDir, rendererOutAssetsDir, { recursive: true });
    }
  };
}
