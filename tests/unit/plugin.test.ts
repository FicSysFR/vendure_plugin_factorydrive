// Copyright 2026 FicSys
// SPDX-License-Identifier: Apache-2.0

import { type AssetServerOptions, AssetServerPlugin } from '@vendure/asset-server-plugin'
import { describe, expect, it } from 'vitest'
import { configureFactorydriveAssetStorage } from '../../src/configure-factorydrive-asset-storage'
import { DEFAULT_ASSET_ROUTE, DEFAULT_ASSET_UPLOAD_DIR } from '../../src/constants'
import { FactorydriveAssetConfigurationError } from '../../src/errors'
import { FactorydriveAssetPlugin } from '../../src/factorydrive-asset-plugin'
import { FactorydriveAssetStorageStrategy } from '../../src/factorydrive-asset-storage-strategy'

function currentAssetServerOptions(): AssetServerOptions {
  return (AssetServerPlugin as unknown as { options: AssetServerOptions }).options
}

describe('configureFactorydriveAssetStorage', () => {
  it('returns a storageStrategyFactory producing Factorydrive strategies with Vendure URLs', async () => {
    const factory = configureFactorydriveAssetStorage({ disk: 'assets' })

    const strategy = await factory({ route: 'assets', assetUploadDir: DEFAULT_ASSET_UPLOAD_DIR, assetUrlPrefix: 'https://api.example.com/assets/' })

    expect(strategy).toBeInstanceOf(FactorydriveAssetStorageStrategy)
    // biome-ignore lint/suspicious/noExplicitAny: the request is not used with a string prefix.
    expect(strategy.toAbsoluteUrl?.({} as any, 'source/ab/a.png')).toBe('https://api.example.com/assets/source/ab/a.png')
  })

  it('validates the disk option eagerly', () => {
    expect(() => configureFactorydriveAssetStorage({ disk: ' ' })).toThrow(FactorydriveAssetConfigurationError)
  })

  it('creates a fresh strategy per call (Vendure runs plugin configuration once per bootstrap)', async () => {
    const factory = configureFactorydriveAssetStorage()
    const options = { route: 'assets', assetUploadDir: DEFAULT_ASSET_UPLOAD_DIR }

    expect(await factory(options)).not.toBe(await factory(options))
  })
})

describe('FactorydriveAssetPlugin.init', () => {
  it('returns the official AssetServerPlugin configured with the Factorydrive storage factory', async () => {
    const presets = [{ name: 'product-card', width: 600, height: 750, mode: 'crop' as const }]

    const plugin = FactorydriveAssetPlugin.init({
      disk: 'assets',
      assetServer: { route: 'media', assetUrlPrefix: 'https://api.example.com/media/', presets, assetUploadDir: '/tmp/vendure-cache' },
    })

    expect(plugin).toBe(AssetServerPlugin)
    const options = currentAssetServerOptions()
    expect(options.route).toBe('media')
    expect(options.assetUploadDir).toBe('/tmp/vendure-cache')
    expect(options.presets).toBe(presets)
    expect(options.assetUrlPrefix).toBe('https://api.example.com/media/')
    const strategy = await options.storageStrategyFactory?.(options)
    expect(strategy).toBeInstanceOf(FactorydriveAssetStorageStrategy)
  })

  it('works without any option (default disk, /assets route, temp upload dir)', () => {
    FactorydriveAssetPlugin.init()

    const options = currentAssetServerOptions()
    expect(options.route).toBe(DEFAULT_ASSET_ROUTE)
    expect(options.assetUploadDir).toBe(DEFAULT_ASSET_UPLOAD_DIR)
    expect(typeof options.storageStrategyFactory).toBe('function')
  })

  it('refuses a custom storageStrategyFactory', () => {
    expect(() =>
      FactorydriveAssetPlugin.init({
        // biome-ignore lint/suspicious/noExplicitAny: simulating a JavaScript caller.
        assetServer: { storageStrategyFactory: () => ({}) } as any,
      }),
    ).toThrow(FactorydriveAssetConfigurationError)
  })
})
