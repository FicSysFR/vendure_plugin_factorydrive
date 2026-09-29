import { defineConfig } from 'vitest/config'

/**
 * Opt-in S3-compatible end-to-end tests (FACTORYDRIVE_E2E_S3=1, Docker or an existing endpoint).
 * Same transform setup as vitest.e2e.config.mts.
 *
 * Vendure and Factorydrive ship compiled code, so only the test files are transformed here.
 * They use legacy decorators (`@VendurePlugin`) but never rely on `emitDecoratorMetadata`
 * (providers are wired with `useFactory` + `inject`), so Vitest's built-in esbuild is enough
 * and no native SWC binary is required.
 */
export default defineConfig({
  esbuild: {
    target: 'es2022',
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
        useDefineForClassFields: false,
      },
    },
  },
  resolve: {
    // Avoid loading both the ESM and CJS builds of graphql ("Cannot use GraphQLSchema from another module or realm").
    alias: [{ find: /^graphql$/, replacement: 'graphql/index.js' }],
  },
  test: {
    include: ['e2e/s3/**/*.e2e-spec.ts'],
    exclude: ['node_modules/**'],
    pool: 'forks',
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 300_000,
    server: {
      deps: {
        fallbackCJS: true,
      },
    },
  },
})
