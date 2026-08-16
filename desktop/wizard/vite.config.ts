import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" keeps the build loadable via loadFile() from the packaged app.
export default defineConfig({
  plugins: [react()],
  base: "./",
});
