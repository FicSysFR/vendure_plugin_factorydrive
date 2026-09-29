# ADR 0001: Integrate through `storageStrategyFactory` and `init(injector)`

- Status: accepted
- Date: 2026-09-29

## Context

The package must let Vendure store assets on a Factorydrive disk while:

- reusing the official `@vendure/asset-server-plugin` (route, URLs, previews, presets, Sharp, transformation cache);
- obtaining `FactorydriveService` through NestJS dependency injection (no `new FactorydriveService()`, no global singleton);
- keeping every provider setting (bucket, endpoint, credentials...) in the Factorydrive configuration.

Facts verified against Vendure 3.0.0 – 3.8 (prerelease) sources:

1. `AssetServerOptions.storageStrategyFactory(options)` is called from the AssetServerPlugin `configuration` hook, during `preBootstrapConfig()`, **before** the Nest application exists. It receives no injector. It also runs in the migration CLI.
2. `ConfigModule.onApplicationBootstrap()` calls `init(injector)` on `assetOptions.assetStorageStrategy`, in the server **and** in the worker, after every module's `onModuleInit` (so after `FactorydriveService` has built its disks). `Injector.get()` uses `ModuleRef.get(token, { strict: false })` and resolves providers from any module.
3. `VendureConfig.plugins` accepts plain Nest `DynamicModule`s, so `FactorydriveModule.forRoot()` can be listed directly; its core module is `@Global()`.
4. Vendure only runs `configuration` hooks and compatibility checks for **top-level** plugins.
5. The AssetServerPlugin keeps its options in a static field and always overwrites `assetOptions.assetStorageStrategy` (local disk by default).

## Decision

- `FactorydriveAssetStorageStrategy` implements `AssetStorageStrategy`. It is constructed without I/O by the factory and resolves `FactorydriveService` and its disk in `init(injector)`.
- `configureFactorydriveAssetStorage({ disk })` returns the `storageStrategyFactory` (same shape as Vendure's `configureS3AssetStorage`). It also builds `toAbsoluteUrl` from the AssetServerPlugin options using the plugin's own `getAssetUrlPrefixFn`, so URLs are identical to Vendure's built-in strategies.
- `FactorydriveAssetPlugin.init({ disk, assetServer })` is sugar that **returns** `AssetServerPlugin.init({ ...assetServer, storageStrategyFactory })`. The top-level plugin therefore *is* the official one.

## Rejected alternatives

- **A wrapper plugin that `imports` the AssetServerPlugin**: the nested plugin's `configuration` hook would never run (fact 4), so no storage, preview or naming strategy would be installed.
- **A second plugin that overwrites `assetOptions.assetStorageStrategy` in its own `configuration` hook**: correctness would depend on the order of the `plugins` array, and the AssetServerPlugin would still build a local strategy first.
- **Resolving Factorydrive in the factory**: impossible without bypassing Nest (fact 1).
- **Copying `getAssetUrlPrefixFn`**: the way it reads the RequestContext changed between 3.0 and 3.7; reusing it keeps parity. It is loaded through a guarded deep `require`, with the public `defaultAssetStorageStrategyFactory` as fallback, and a unit test acts as a canary.

## Consequences

- Users list `FactorydriveModule.forRoot()` once, and either `FactorydriveAssetPlugin.init()` or `AssetServerPlugin.init({ storageStrategyFactory })`, never both.
- A missing module, unknown disk or incomplete driver fails the bootstrap with an explicit error instead of failing on the first request.
- `assetUploadDir` is still required by the AssetServerPlugin (it creates `<dir>/cache` on startup); the sugar defaults it to a temp directory.
