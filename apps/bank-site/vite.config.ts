import { publicViteConfig } from "@keycade/config/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  ...publicViteConfig({ name: "bank-site", port: 3000 }),
  plugins: [react(), tailwindcss()],
});
