import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// 单一构建产物：主界面 index.html 与桌面配置向导 wizard.html 同一 vite build
// 输出到 dist/，Electron 壳直接 link 其中的 wizard.html（file:// 加载需要
// 相对资源路径，故 base "./"；主界面始终由桥服务在 "/" 下，相对路径等价）。
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "./",
  build: {
    rollupOptions: {
      input: {
        main: path.join(import.meta.dirname, "index.html"),
        wizard: path.join(import.meta.dirname, "wizard.html"),
      },
    },
  },
  resolve: {
    alias: {
      "@": path.join(import.meta.dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8765",
    },
  },
});
