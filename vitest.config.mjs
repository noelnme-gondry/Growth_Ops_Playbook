import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// `@/*` → ./src/* (mirrors jsconfig.json paths so component imports resolve in tests)
const srcAlias = {
  "@": fileURLToPath(new URL("./src", import.meta.url)),
};

// Vitest 4 transforms JSX with oxc by default (React 19 automatic runtime) — no
// @vitejs/plugin-react needed for render-smoke (we only mount + assert-no-throw).
export default defineConfig({
  resolve: { alias: srcAlias },
  test: {
    // Two projects run under one `vitest run`:
    //  • golden — pure math in src/utils, node env (155 tests, byte-identical guarantee)
    //  • smoke  — component RENDER regression net, jsdom env (*.smoke.test.jsx)
    projects: [
      {
        resolve: { alias: srcAlias },
        test: {
          name: "golden",
          environment: "node",
          include: ["src/**/*.test.js"],
        },
      },
      {
        resolve: { alias: srcAlias },
        test: {
          name: "smoke",
          environment: "jsdom",
          include: ["src/**/*.smoke.test.jsx"],
          setupFiles: ["./vitest.smoke.setup.js"],
        },
      },
    ],
  },
});
