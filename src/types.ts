// Copyright 2026 FicSys
// SPDX-License-Identifier: Apache-2.0

import type { AssetServerOptions } from '@vendure/asset-server-plugin'
import type { AssetStorageStrategy } from '@vendure/core'

/**
 * Options of the Factorydrive asset storage strategy.
 *
 * Only the disk name lives here: bucket, endpoint, region, credentials, root folder...
 * belong to the Factorydrive disk configuration (`FactorydriveModule.forRoot`).
 */
export interface FactorydriveAssetStorageOptions {
  /**
   * Name of the Factorydrive disk that stores Vendure assets.
   * When omitted, the Factorydrive `default` disk is used.
   */
  disk?: string
}

/**
 * AssetServerPlugin options accepted by {@link FactorydriveAssetPlugin.init}.
 *
 * `storageStrategyFactory` is managed by this package. `route` defaults to `'assets'` and
 * `assetUploadDir` to a directory under the OS temp dir (the AssetServerPlugin only uses it
 * to create an empty `cache` folder when a custom storage strategy is configured).
 */
export type FactorydriveAssetServerOptions = Omit<AssetServerOptions, 'storageStrategyFactory' | 'assetUploadDir' | 'route'> & {
  route?: string
  assetUploadDir?: string
}

export interface FactorydriveAssetPluginOptions extends FactorydriveAssetStorageOptions {
  /** Options forwarded to the official `AssetServerPlugin`. */
  assetServer?: FactorydriveAssetServerOptions
}

/** Request object Vendure passes to `AssetStorageStrategy.toAbsoluteUrl` (Express 4 or 5 depending on the Vendure version). */
export type AssetRequest = Parameters<NonNullable<AssetStorageStrategy['toAbsoluteUrl']>>[0]

/** Converts a stored asset identifier into the absolute URL exposed by the GraphQL APIs. */
export type ToAbsoluteUrlFn = (request: AssetRequest, identifier: string) => string
