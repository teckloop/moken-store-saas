import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    allowedHosts: [
      "merchant.moken-saas.online"
    ]
  }
});
