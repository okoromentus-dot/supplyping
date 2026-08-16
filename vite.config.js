import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Injects a real build timestamp at compile time so the console marker
// changes on EVERY build. A hand-edited version string silently goes stale
// and then can't tell you whether a deploy actually landed — which has cost
// real debugging time.
export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString().slice(0, 16).replace("T", " ")),
  },
});
