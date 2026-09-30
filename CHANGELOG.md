# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.3] - 2026-09-30

### Fixed

- Correct the GitHub repository URLs in the npm package metadata to use `vendure_plugin_factorydrive`.
- Build and verify the npm package in the release job so the published archive includes the compiled JavaScript
  and TypeScript declarations in `dist/`, even when `npm publish` skips lifecycle scripts.

## [0.1.2] - 2026-09-30

### Fixed

- Release workflow: `npm publish` now runs with `--ignore-scripts` so its `prepublishOnly` hook
  (which shells out to yarn) doesn't hit the same Yarn Classic `${NODE_AUTH_TOKEN}` error, this
  time triggered during the publish step itself. The check suite it would have re-run already ran
  in the `ci` job that gates this workflow.

## [0.1.1] - 2026-09-30

### Fixed

- Release workflow: the npm registry setup step (`actions/setup-node` with `registry-url`) ran before
  `yarn install`, which broke the install with a Yarn Classic error (`Failed to replace env in config:
  ${NODE_AUTH_TOKEN}`) since no static npm token is set (publishing uses OIDC Trusted Publishing). The
  registry setup is now deferred until immediately before `npm publish`.

## [0.1.0] - 2026-09-30

### Added

- `FactorydriveAssetStorageStrategy`: Vendure `AssetStorageStrategy` backed by a Factorydrive disk, resolved through
  NestJS dependency injection in `init(injector)` on the server and the worker.
- `configureFactorydriveAssetStorage({ disk })`: `storageStrategyFactory` for `AssetServerPlugin.init()`, with asset URLs
  identical to Vendure's built-in strategies.
- `FactorydriveAssetPlugin.init({ disk, assetServer })`: returns the official `AssetServerPlugin` configured with the
  Factorydrive storage.
- Streaming uploads (`writeFileFromStream` hands the stream to `disk.put()` untouched), idempotent deletes, strict
  `fileExists`, key validation against path traversal, contextual logging without secrets.
- Unit tests with an in-memory Factorydrive driver; end-to-end tests against a real Vendure server (local disk, custom
  driver registration, optional S3-compatible storage with RustFS).
