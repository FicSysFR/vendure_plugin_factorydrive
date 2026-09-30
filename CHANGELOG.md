# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
