import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:5174",
        changeOrigin: true,
      },
      "/socket.io": {
        // Must support both websocket and long-polling transports
        target: "http://localhost:5174",
        ws: true,
      },
      "/flappy-bird": {
        target: "http://localhost:5174",
        changeOrigin: true,
      },
    },
  },
});

