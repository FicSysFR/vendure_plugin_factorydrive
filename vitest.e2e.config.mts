import { defineConfig } from 'vitest/config'

/**
 * End-to-end tests boot a real Vendure server (@vendure/testing + sql.js).
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
    include: ['e2e/**/*.e2e-spec.ts'],
    exclude: ['e2e/s3/**', 'node_modules/**'],
    pool: 'forks',
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 180_000,
    server: {
      deps: {
        fallbackCJS: true,
      },
    },
  },
})
