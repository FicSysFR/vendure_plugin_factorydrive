# @ficsysfr/vendure-plugin-factorydrive

Store [Vendure](https://vendure.io) assets on any [Factorydrive](https://github.com/FicSysFR/nestjs_module_factorydrive) disk:
local filesystem, S3, RustFS, MinIO, Cloudflare R2, SFTP or your own driver.

The package is only a bridge. The official `@vendure/asset-server-plugin` keeps serving `/assets`, building URLs,
generating previews and running Sharp transformations (presets, resize, crop, quality, WebP, AVIF, focal point) with its
cache. This package only replaces **where the bytes are stored**.

```
Vendure ──▶ AssetServerPlugin ──▶ FactorydriveAssetStorageStrategy ──▶ FactorydriveService ──▶ disk
                                                                                                ├── local
                                                                                                ├── S3 / RustFS / MinIO / R2
                                                                                                ├── SFTP
                                                                                                └── custom driver
```

## Compatibility

| Package | Versions |
| --- | --- |
| `@vendure/core`, `@vendure/asset-server-plugin` | `^3.0.0`. Tested against 3.0.8 (NestJS 10), 3.5.7 and 3.7.3 (NestJS 11) |
| `@ficsysfr/nestjs_module_factorydrive` | `^2.0.0` |
| Node.js | `>= 22.12` |

There is no Vendure 4 release yet, so no compatibility with it is claimed. Vendure 3.8 (currently a prerelease) moves to
NestJS 12, which Factorydrive 2.0 does not list in its peer range yet; it runs in CI as a non-blocking job.

## Installation

The package has **no runtime dependency**: Vendure, the AssetServerPlugin and Factorydrive are peer dependencies, so the
application owns a single copy of each (Factorydrive's `FactorydriveService` is resolved by class through NestJS DI, and
a second copy would not be found). Storage drivers are installed by the application, never by this package.

```bash
npm install @ficsysfr/nestjs_module_factorydrive @ficsysfr/vendure-plugin-factorydrive
```

## Quick start (local disk)

```ts
import { FactorydriveModule } from '@ficsysfr/nestjs_module_factorydrive'
import { FactorydriveAssetPlugin } from '@ficsysfr/vendure-plugin-factorydrive'
import type { VendureConfig } from '@vendure/core'

export const config: VendureConfig = {
  // ...
  plugins: [
    // 1. Factorydrive: disks and drivers belong here.
    FactorydriveModule.forRoot({
      default: 'assets',
      disks: {
        assets: { driver: 'local', config: { root: './storage/vendure-assets' } },
      },
    }),

    // 2. Vendure assets: only the disk name.
    FactorydriveAssetPlugin.init({
      disk: 'assets',
      assetServer: {
        route: 'assets',
        assetUrlPrefix: 'https://api.example.com/assets/',
      },
    }),
  ],
}
```

`FactorydriveModule.forRoot()` is a regular NestJS dynamic module and can be listed directly in `plugins`. Register it
**once** per application. At startup Vendure logs `The plugin "undefined" does not specify a compatibility range...`
for it, because it is a plain NestJS module rather than a Vendure plugin: this message is informational.

## Two equivalent ways to configure Vendure

`FactorydriveAssetPlugin.init()` returns the **official** `AssetServerPlugin`, already configured. It does not wrap or
re-implement it. These two configurations are identical:

```ts
// Sugar
FactorydriveAssetPlugin.init({
  disk: 'assets',
  assetServer: {
    route: 'assets',
    assetUploadDir: path.join(__dirname, '../static/assets'),
    assetUrlPrefix: 'https://api.example.com/assets/',
    presets: [{ name: 'product-card', width: 600, height: 750, mode: 'crop' }],
  },
})

// Explicit
import { AssetServerPlugin } from '@vendure/asset-server-plugin'
import { configureFactorydriveAssetStorage } from '@ficsysfr/vendure-plugin-factorydrive'

AssetServerPlugin.init({
  route: 'assets',
  assetUploadDir: path.join(__dirname, '../static/assets'),
  assetUrlPrefix: 'https://api.example.com/assets/',
  presets: [{ name: 'product-card', width: 600, height: 750, mode: 'crop' }],
  storageStrategyFactory: configureFactorydriveAssetStorage({ disk: 'assets' }),
})
```

Use one or the other, not both: the AssetServerPlugin stores its options in a static field.

### Options

| Option | Default | Description |
| --- | --- | --- |
| `disk` | Factorydrive `default` disk | Name of the Factorydrive disk that stores Vendure assets. |
| `assetServer` | `{}` | Every `AssetServerOptions` field except `storageStrategyFactory`. |
| `assetServer.route` | `'assets'` | Route of the AssetServerPlugin middleware. |
| `assetServer.assetUploadDir` | `<os tmpdir>/vendure-factorydrive-assets` | Required by the AssetServerPlugin, which creates an empty `cache` folder in it at startup even with a custom storage. No asset is stored there. |

Everything else (`assetUrlPrefix`, `presets`, `imageTransformStrategy`, `namingStrategy`, `previewStrategy`,
`cacheHeader`...) behaves exactly as documented by Vendure. The plugin never receives bucket names, endpoints,
regions, credentials or `forcePathStyle`: these are Factorydrive disk settings.

## S3, RustFS, MinIO, Cloudflare R2

```bash
npm install \
  @ficsysfr/nestjs_module_factorydrive \
  @ficsysfr/nestjs_module_factorydrive-s3 \
  @ficsysfr/vendure-plugin-factorydrive
```

```ts
import { FactorydriveModule } from '@ficsysfr/nestjs_module_factorydrive'
import { AwsS3Storage } from '@ficsysfr/nestjs_module_factorydrive-s3'

FactorydriveModule.forRoot({
  default: 'assets',
  drivers: { s3: AwsS3Storage }, // Factorydrive >= 2.1, see "Registering drivers" for 2.0
  disks: {
    assets: {
      driver: 's3',
      config: {
        bucket: process.env.S3_BUCKET!,
        endpoint: process.env.S3_ENDPOINT!, // e.g. http://rustfs:9000
        region: process.env.S3_REGION ?? 'us-east-1',
        forcePathStyle: true,
        credentials: {
          accessKeyId: process.env.S3_ACCESS_KEY!,
          secretAccessKey: process.env.S3_SECRET_KEY!,
        },
      },
    },
  },
})
```

The Vendure side does not change: `FactorydriveAssetPlugin.init({ disk: 'assets' })`.

RustFS, MinIO and R2 are just S3-compatible endpoints: point `endpoint` at them and keep `forcePathStyle: true` where
the provider requires path-style addressing. The plugin contains nothing specific to any of them.

- **Bucket visibility**: nothing has to be public. Assets are read by Vendure and served through `/assets`; the plugin
  never generates public or signed URLs.
- **Permissions**: the credentials need `GetObject`, `PutObject`, `DeleteObject` and `ListBucket`. Without
  `ListBucket`, S3 answers 403 instead of 404 for missing keys; the plugin then refuses to guess (see
  [Error handling](#error-handling-and-logs)) and uploads fail.

> [!WARNING]
> **Known limitation of `@ficsysfr/nestjs_module_factorydrive-s3` 2.0.0**: its `put()` sends streams with `putObject`,
> which requires a known length. Vendure uploads larger than 4100 bytes are streams of unknown length, so they are
> rejected client-side (`Invalid value "undefined" for header "x-amz-decoded-content-length"`), whatever the endpoint.
> Buffers (previews, transformations, small files) work. The fix belongs to the S3 driver (multipart `Upload` from
> `@aws-sdk/lib-storage` for streams). This plugin deliberately does not buffer uploads in memory to work around it.

## Registering drivers

The `local` driver is built in. Other drivers must be registered **before** Factorydrive builds its disks.

- **Factorydrive >= 2.1**: declare them in `FactorydriveModule.forRoot({ drivers: { s3: AwsS3Storage }, ... })`.
- **Factorydrive 2.0**: Vendure applications have no `AppModule` constructor, so register them from a provider
  factory. NestJS instantiates every provider before running any `onModuleInit` hook, which is when disks are built:

```ts
import { FactorydriveService } from '@ficsysfr/nestjs_module_factorydrive'
import { AwsS3Storage } from '@ficsysfr/nestjs_module_factorydrive-s3'
import { PluginCommonModule, VendurePlugin } from '@vendure/core'

@VendurePlugin({
  imports: [PluginCommonModule],
  providers: [
    {
      provide: 'FACTORYDRIVE_DRIVERS',
      inject: [FactorydriveService],
      useFactory: (factorydrive: FactorydriveService) => {
        factorydrive.registerDriver('s3', AwsS3Storage)
        return true
      },
    },
  ],
  compatibility: '^3.0.0',
})
export class FactorydriveDriversPlugin {}

// plugins: [FactorydriveModule.forRoot({...}), FactorydriveDriversPlugin, FactorydriveAssetPlugin.init({...})]
```

Do not register drivers in a plugin's `onModuleInit`: Factorydrive's module is global, and NestJS may run its
`onModuleInit` (which builds the disks) first.

`@ficsysfr/nestjs_module_factorydrive-s3` is an ES module. CommonJS Vendure builds load it through Node's
`require(esm)`, available without flags from Node 22.12.

## Several disks

```ts
FactorydriveModule.forRoot({
  default: 'assets',
  disks: {
    assets: { driver: 's3', config: { /* ... */ } },
    documents: { driver: 's3', config: { /* ... */ } },
    backups: { driver: 'sftp', config: { /* ... */ } },
  },
})

FactorydriveAssetPlugin.init({ disk: 'assets' })
```

Vendure only ever reads, writes and deletes on the configured disk. The rest of the application can keep using the
other disks through `FactorydriveService`.

## Server, worker and multiple instances

Vendure runs the API server and the worker as separate processes (and production setups often run several of each).
Every process gets its own `FactorydriveService` and resolves the disk in the strategy's `init()`, which Vendure calls
in both the server and the worker. The plugin keeps no file state in memory.

The disk used for assets must therefore be **shared** by every instance: an object store (RustFS, S3, MinIO, R2...),
SFTP, or a network filesystem. A `local` disk only works when every process sees the same directory.

```
              RustFS / S3
             /           \
   Vendure API           Vendure Worker
   (N instances)         (M instances)
```

## How it works

| Vendure `AssetStorageStrategy` | Factorydrive disk |
| --- | --- |
| `writeFileFromBuffer(name, buffer)` | `put(key, buffer)` |
| `writeFileFromStream(name, stream)` | `put(key, stream)`: the stream is handed over untouched |
| `readFileToBuffer(id)` | `getBuffer(key).content` (rejects when missing, which is how the AssetServerPlugin detects cache misses) |
| `readFileToStream(id)` | `getStream(key)` |
| `deleteFile(id)` | `delete(key)` (a missing file is not an error) |
| `fileExists(name)` | `exists(key).exists` (provider errors are propagated, never reported as "missing") |
| `toAbsoluteUrl(req, id)` | AssetServerPlugin URL rules (`assetUrlPrefix` string, function, or derived from the request) |

**Keys and identifiers.** Vendure builds names with `path.join`, so they contain backslashes on Windows, and keys
derived from `/assets/...` requests start with a separator. Every key is normalised to a relative, forward-slash
location (`source/ab/image.jpg`, `preview/cd/image__preview.jpg`, `cache/...`), which is also the identifier stored in
the database. Identifiers are therefore portable across operating systems and providers, and match the layout of
Vendure's local strategy: migrating existing assets means copying the `source/`, `preview/` (and optionally `cache/`)
folders to the disk root.

**Lifecycle.** `storageStrategyFactory` runs while Vendure prepares its configuration, before NestJS DI exists (and in
the migration CLI), so it does no I/O. The disk is resolved in `init(injector)` during bootstrap. A missing
`FactorydriveModule`, an unknown disk or a driver lacking `put`, `getBuffer`, `exists` or `delete` stops the bootstrap
with an explicit error. See [ADR 0001](docs/adr/0001-storage-strategy-factory.md) for the reasoning.

## Streaming and memory

- **Uploads** are streamed end to end: `writeFileFromStream` passes Vendure's upload stream straight to `disk.put()`.
  The local driver pipes it to disk; memory usage then depends on the driver.
- **Reads by Vendure are buffered by design**, not by this plugin. In Vendure 3.x the `/assets` route reads files with
  `readFileToBuffer` (Sharp and the HTTP response need the whole file), and preview generation reads the uploaded
  source with `readFileToBuffer`. `readFileToStream` streams, but Vendure 3.x does not call it.
- Buffers are passed through without copies.

## Presets, transformations and cache

Presets, `w`/`h`, `mode=crop|resize`, `q`, `format=webp|avif|jpg|png` and focal points are handled by the
AssetServerPlugin exactly as with the built-in storage (they are covered by this package's end-to-end tests).
Transformed images are written to the same disk under `cache/`. Vendure never deletes cached files, including when
an asset is deleted: plan a lifecycle rule or periodic cleanup of the `cache/` prefix if storage growth matters.

## Error handling and logs

- Errors from Factorydrive (`FileNotFoundException`, `PermissionMissingException`, `NoSuchBucketException`,
  `UnknownException`, `DriverNotSupportedException`...) are **rethrown unchanged**, so callers can still inspect them.
- Every failure is logged with the Vendure logger (context `FactorydriveAssetStorage`) with the disk, the operation and
  the key: `readFileToBuffer failed on Factorydrive disk "assets" for key "cache/source/ab/x.webp": FileNotFoundException [E_FILE_NOT_FOUND]: ...`.
- Missing files on the read path (cache misses, 404s) are logged at `debug` level; everything else at `error` level.
- Logs never contain credentials, configuration, provider error objects or file contents. Keys come from URLs and are
  escaped and truncated.
- When a streamed upload fails, the error of the source stream (for example Vendure's upload size limit) is reported
  and the partially written file is removed.

## Security

- Keys containing `..` segments, control characters, UNC paths or drive letters are rejected before reaching the
  driver. This matters on Vendure 3.0.0 – 3.0.7, whose `/assets` route does not sanitise paths.
- No GraphQL field, public URL or signed URL is added. Nothing requires a public bucket.
- No storage SDK is pulled in by this package. Driver-level security (credentials, TLS, bucket policies) stays with
  Factorydrive and the driver.

See [SECURITY.md](SECURITY.md) to report a vulnerability.

## Development

```bash
yarn install
yarn lint && yarn typecheck
yarn test                 # unit tests, in-memory Factorydrive driver
yarn test:e2e             # real Vendure server (sql.js) + local Factorydrive disk
FACTORYDRIVE_E2E_S3=1 yarn test:e2e:s3   # S3 driver against RustFS (Docker) or FACTORYDRIVE_E2E_S3_ENDPOINT
yarn build && yarn smoke
```

Run the suites against another Vendure version with `node scripts/use-vendure-version.cjs 3.0.8 && yarn install`.

## License

[Apache-2.0](LICENSE)
