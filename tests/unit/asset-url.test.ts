// Copyright 2026 FicSys
// SPDX-License-Identifier: Apache-2.0

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type AssetServerOptions, configureS3AssetStorage } from '@vendure/asset-server-plugin'
import type { RequestContext } from '@vendure/core'
import { describe, expect, it } from 'vitest'
import { ASSET_SERVER_COMMON_MODULE, createToAbsoluteUrl, resolveAssetUrlPrefixFn } from '../../src/asset-url'
import { FactorydriveAssetConfigurationError } from '../../src/errors'
import type { AssetRequest } from '../../src/types'

const uploadDir = mkdtempSync(join(tmpdir(), 'vendure-factorydrive-url-'))

function fakeRequest(overrides: Record<string, unknown> = {}): AssetRequest {
  const headers: Record<string, string> = { host: 'shop.example.com' }
  return {
    headers,
    protocol: 'http',
    get: (name: string) => headers[name.toLowerCase()],
    ...overrides,
  } as AssetRequest
}

const optionFlavours: Array<[string, AssetServerOptions]> = [
  ['no prefix (derived from the request host)', { route: 'assets', assetUploadDir: uploadDir }],
  ['string prefix', { route: 'assets', assetUploadDir: uploadDir, assetUrlPrefix: 'https://cdn.example.com/assets/' }],
  [
    'function prefix',
    {
      route: 'assets',
      assetUploadDir: uploadDir,
      assetUrlPrefix: (ctx: RequestContext) => `https://${(ctx as unknown as { channelToken: string }).channelToken}.example.com/assets/`,
    },
  ],
]

/**
 * Reference implementation: Vendure's S3 strategy factory builds its toAbsoluteUrl with the same
 * code as the default local one, and unlike `defaultAssetStorageStrategyFactory` it is exported by
 * every 3.x version. The S3 client is only created in init(), which is never called here.
 */
function vendureToAbsoluteUrl(options: AssetServerOptions) {
  const strategy = configureS3AssetStorage({ bucket: 'unused', credentials: { accessKeyId: 'unused', secretAccessKey: 'unused' } })(options)
  if (!strategy.toAbsoluteUrl) {
    throw new Error('Expected the built-in strategy to expose toAbsoluteUrl')
  }
  return strategy.toAbsoluteUrl.bind(strategy)
}

const identifiers = ['source/ab/image.jpg', 'preview/cd/image__preview.png', '', 'https://cdn.example.com/assets/source/ab/image.jpg']

describe('toAbsoluteUrl', () => {
  const request = fakeRequest({ vendureRequestContext: { default: { channelToken: 'eu' } } })

  it.each(optionFlavours)('matches the AssetServerPlugin built-in strategy with %s', (_label, options) => {
    const ours = createToAbsoluteUrl(resolveAssetUrlPrefixFn(options))
    const vendure = vendureToAbsoluteUrl(options)

    for (const identifier of identifiers) {
      expect(ours(request, identifier)).toBe(vendure(request, identifier))
    }
  })

  it('builds host-based URLs honouring x-forwarded-proto', () => {
    const toAbsoluteUrl = createToAbsoluteUrl(resolveAssetUrlPrefixFn({ route: 'assets', assetUploadDir: uploadDir }))
    const proxied = fakeRequest()
    proxied.headers['x-forwarded-proto'] = 'https'

    expect(toAbsoluteUrl(proxied, 'source/ab/image.jpg')).toBe('https://shop.example.com/assets/source/ab/image.jpg')
  })

  it('serves legacy Windows identifiers with forward slashes', () => {
    const toAbsoluteUrl = createToAbsoluteUrl(() => 'https://cdn.example.com/assets/')

    expect(toAbsoluteUrl(fakeRequest(), 'source\\ab\\image.jpg')).toBe('https://cdn.example.com/assets/source/ab/image.jpg')
  })
})

describe('resolveAssetUrlPrefixFn', () => {
  const options: AssetServerOptions = { route: 'assets', assetUploadDir: uploadDir, assetUrlPrefix: 'https://cdn.example.com/assets/' }

  it('can load the AssetServerPlugin internals it depends on (canary for Vendure upgrades)', () => {
    const common = require(ASSET_SERVER_COMMON_MODULE) as { getAssetUrlPrefixFn?: unknown }
    expect(typeof common.getAssetUrlPrefixFn).toBe('function')
  })

  it('falls back to the public default strategy factory when the internals move', () => {
    const load = (id: string) => {
      if (id === ASSET_SERVER_COMMON_MODULE) {
        throw new Error('Cannot find module')
      }
      // Shape of the public factory exported by Vendure >= 3.6.
      return { defaultAssetStorageStrategyFactory: (factoryOptions: AssetServerOptions) => ({ toAbsoluteUrl: vendureToAbsoluteUrl(factoryOptions) }) }
    }

    const toAbsoluteUrl = createToAbsoluteUrl(resolveAssetUrlPrefixFn(options, load))

    expect(toAbsoluteUrl(fakeRequest(), 'source/ab/image.jpg')).toBe('https://cdn.example.com/assets/source/ab/image.jpg')
    expect(toAbsoluteUrl(fakeRequest(), 'https://cdn.example.com/assets/source/ab/image.jpg')).toBe('https://cdn.example.com/assets/source/ab/image.jpg')
  })

  it('fails with a configuration error when no URL logic can be found', () => {
    expect(() => resolveAssetUrlPrefixFn(options, () => ({}))).toThrow(FactorydriveAssetConfigurationError)
  })
})
