import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
  },
  site: 'https://bud-san.github.io/',
  base: '/learning-threejs-slider/'
});
