/**
 * Vitest config.
 *
 * Scoped deliberately narrowly: this project's tests cover the pure domain
 * math and the platform normalizers, and nothing else. Those are the places
 * where a mistake is *silent* — a wrong win probability does not throw, it
 * states a confident number that happens to be false — which is exactly the
 * failure the rest of this codebase's conventions exist to avoid.
 *
 * Everything here must stay hermetic: no network, no database, no clock. The
 * repo's CI note is explicit that a build gate depending on a third party is a
 * gate that fails for reasons unrelated to the commit, and the same reasoning
 * applies to tests. Normalizers are tested against captured payloads, not
 * against ESPN.
 *
 * The `@/` alias is resolved here rather than by adding vite-tsconfig-paths,
 * to keep this to one new devDependency.
 */
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
