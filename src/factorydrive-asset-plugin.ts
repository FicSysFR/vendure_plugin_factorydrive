// Copyright 2026 FicSys
// SPDX-License-Identifier: Apache-2.0

import { AssetServerPlugin } from '@vendure/asset-server-plugin'
import { configureFactorydriveAssetStorage } from './configure-factorydrive-asset-storage'
import { DEFAULT_ASSET_ROUTE, DEFAULT_ASSET_UPLOAD_DIR } from './constants'
import { FactorydriveAssetConfigurationError } from './errors'
import type { FactorydriveAssetPluginOptions } from './types'

/**
 * Convenience entry point: returns the official `AssetServerPlugin`, configured to store assets
 * on a Factorydrive disk.
 *
 * ```ts
 * plugins: [
 *   FactorydriveModule.forRoot({ default: 'assets', disks: { assets: { driver: 'local', config: { root: './storage/assets' } } } }),
 *   FactorydriveAssetPlugin.init({ disk: 'assets', assetServer: { assetUrlPrefix: 'https://api.example.com/assets/' } }),
 * ]
 * ```
 *
 * It does not wrap or re-implement the AssetServerPlugin: the value returned *is*
 * `AssetServerPlugin.init(...)`, so Vendure runs its configuration hook, compatibility check,
 * `/assets` middleware, presets, Sharp transformations and cache exactly as usual. Because the
 * AssetServerPlugin keeps its options in a static field, do not also list
 * `AssetServerPlugin.init(...)` in the same config.
 *
 * The class is abstract so that listing `FactorydriveAssetPlugin` without `.init()` is a type error.
 */
export abstract class FactorydriveAssetPlugin {
  public static init(options: FactorydriveAssetPluginOptions = {}): ReturnType<typeof AssetServerPlugin.init> {
    const { disk, assetServer = {} } = options
    if ('storageStrategyFactory' in assetServer) {
      throw new FactorydriveAssetConfigurationError(
        'assetServer.storageStrategyFactory is managed by FactorydriveAssetPlugin. Use AssetServerPlugin.init() directly to provide your own factory.',
      )
    }
    const { route = DEFAULT_ASSET_ROUTE, assetUploadDir = DEFAULT_ASSET_UPLOAD_DIR, ...rest } = assetServer

    return AssetServerPlugin.init({
      ...rest,
      route,
      assetUploadDir,
      storageStrategyFactory: configureFactorydriveAssetStorage({ disk }),
    })
  }
}
