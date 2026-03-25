import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "https://panning.dengjiabei.cn",
        changeOrigin: true,
        secure: false,
        ws: true,
      },
    },
  },
});
