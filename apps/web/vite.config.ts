import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5177,
    allowedHosts: [
      "moken-store.cloud",
      "www.moken-store.cloud"
    ]
  }
});
