// Copyright 2026 FicSys
// SPDX-License-Identifier: Apache-2.0

import type { AssetServerOptions } from '@vendure/asset-server-plugin'
import { FactorydriveAssetConfigurationError } from './errors'
import type { AssetRequest, ToAbsoluteUrlFn } from './types'

type AssetUrlPrefixFn = (request: AssetRequest, identifier: string) => string

interface AssetServerCommonModule {
  getAssetUrlPrefixFn?: (options: AssetServerOptions) => AssetUrlPrefixFn
}

interface AssetServerPluginModule {
  defaultAssetStorageStrategyFactory?: (options: AssetServerOptions) => { toAbsoluteUrl?: AssetUrlPrefixFn }
}

/**
 * Module loader, injectable for tests. Defaults to Node's `require` (this package is CommonJS).
 */
export type ModuleLoader = (id: string) => unknown

/**
 * Deep module holding the AssetServerPlugin's own URL prefix logic.
 *
 * `getAssetUrlPrefixFn` is not re-exported by the package index, but it has lived at this path
 * with the same signature from Vendure 3.0.0 to 3.8. Reusing it (instead of copying it) keeps
 * every `assetUrlPrefix` flavour (unset, string, function of RequestContext) byte-for-byte
 * identical to Vendure's local and S3 strategies, including the version-specific way the
 * RequestContext is read from the request.
 */
export const ASSET_SERVER_COMMON_MODULE = '@vendure/asset-server-plugin/lib/src/common.js'

function tryLoad<T>(load: ModuleLoader, id: string): T | undefined {
  try {
    return load(id) as T
  } catch {
    return undefined
  }
}

/**
 * Returns Vendure's `(request, identifier) => prefix` function for the given AssetServerPlugin options.
 *
 * Resolution order:
 * 1. `getAssetUrlPrefixFn` from the AssetServerPlugin internals (all 3.x versions);
 * 2. the public `defaultAssetStorageStrategyFactory(options).toAbsoluteUrl` (exported since 3.6);
 * 3. otherwise a configuration error, surfaced at bootstrap rather than on the first request.
 */
export function resolveAssetUrlPrefixFn(options: AssetServerOptions, load: ModuleLoader = require): AssetUrlPrefixFn {
  const common = tryLoad<AssetServerCommonModule>(load, ASSET_SERVER_COMMON_MODULE)
  if (typeof common?.getAssetUrlPrefixFn === 'function') {
    return common.getAssetUrlPrefixFn(options)
  }

  const plugin = tryLoad<AssetServerPluginModule>(load, '@vendure/asset-server-plugin')
  if (typeof plugin?.defaultAssetStorageStrategyFactory === 'function') {
    const toAbsoluteUrl = plugin.defaultAssetStorageStrategyFactory(options).toAbsoluteUrl
    if (typeof toAbsoluteUrl === 'function') {
      // The default strategy's toAbsoluteUrl already applies the "prefix + identifier" rule;
      // expose it as a prefix function by feeding it an empty identifier.
      return (request, identifier) => {
        const absolute = toAbsoluteUrl(request, identifier)
        return absolute.endsWith(identifier) ? absolute.slice(0, absolute.length - identifier.length) : absolute
      }
    }
  }

  throw new FactorydriveAssetConfigurationError(
    'Unable to load the AssetServerPlugin URL prefix logic. Check that @vendure/asset-server-plugin is installed and matches a supported Vendure 3.x version.',
  )
}

/**
 * Builds `AssetStorageStrategy.toAbsoluteUrl` with the same semantics as Vendure's built-in
 * strategies: empty identifiers stay empty, identifiers that already carry the prefix are
 * returned untouched, everything else is `prefix + identifier`.
 *
 * Identifiers written by this package never contain backslashes. Legacy identifiers written by
 * Vendure's local strategy on Windows (`source\ab\file.jpg`) are emitted with forward slashes,
 * which is how URL parsers interpret them anyway.
 */
export function createToAbsoluteUrl(prefixFn: AssetUrlPrefixFn): ToAbsoluteUrlFn {
  return (request, identifier) => {
    if (!identifier) {
      return ''
    }
    const prefix = prefixFn(request, identifier)
    if (identifier.startsWith(prefix)) {
      return identifier
    }
    return `${prefix}${identifier.replace(/\\/g, '/')}`
  }
}
