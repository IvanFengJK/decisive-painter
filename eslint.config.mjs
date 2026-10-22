import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["web/vendor/", "out/", "graft/", "node_modules/"] },
  js.configs.recommended,
  {
    files: ["web/**/*.js"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: { ...globals.browser } },
  },
  {
    files: ["web/model-worker.js"],
    languageOptions: { globals: { ...globals.worker } },
  },
  {
    files: ["tests/**/*.mjs", "*.mjs"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: { ...globals.node } },
  },
];
