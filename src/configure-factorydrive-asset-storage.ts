// Copyright 2026 FicSys
// SPDX-License-Identifier: Apache-2.0

import type { AssetServerOptions } from '@vendure/asset-server-plugin'
import { createToAbsoluteUrl, resolveAssetUrlPrefixFn } from './asset-url'
import { assertDiskOption, FactorydriveAssetStorageStrategy } from './factorydrive-asset-storage-strategy'
import type { FactorydriveAssetStorageOptions } from './types'

/**
 * Creates an `AssetServerOptions.storageStrategyFactory` that stores Vendure assets on a
 * Factorydrive disk.
 *
 * ```ts
 * AssetServerPlugin.init({
 *   route: 'assets',
 *   assetUploadDir: path.join(__dirname, '../static/assets'),
 *   storageStrategyFactory: configureFactorydriveAssetStorage({ disk: 'assets' }),
 * })
 * ```
 *
 * The factory runs while Vendure prepares its configuration, before Nest's dependency injection
 * exists (and also in the migration CLI), so it performs no I/O: the Factorydrive disk is only
 * resolved when Vendure calls the strategy's `init(injector)` during bootstrap.
 */
export function configureFactorydriveAssetStorage(options: FactorydriveAssetStorageOptions = {}): (assetServerOptions: AssetServerOptions) => FactorydriveAssetStorageStrategy {
  // Validate eagerly so a misconfiguration fails when the config is built, not at bootstrap.
  assertDiskOption(options.disk)
  const storageOptions: FactorydriveAssetStorageOptions = { disk: options.disk }

  return (assetServerOptions) => new FactorydriveAssetStorageStrategy(storageOptions, createToAbsoluteUrl(resolveAssetUrlPrefixFn(assetServerOptions)))
}
