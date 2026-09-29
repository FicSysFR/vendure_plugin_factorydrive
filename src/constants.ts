// Copyright 2026 FicSys
// SPDX-License-Identifier: Apache-2.0

import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Logger context used for every log line emitted by this package. */
export const loggerCtx = 'FactorydriveAssetStorage'

/** Route used by {@link FactorydriveAssetPlugin.init} when `assetServer.route` is omitted. */
export const DEFAULT_ASSET_ROUTE = 'assets'

/**
 * Local directory handed to the AssetServerPlugin when `assetServer.assetUploadDir` is omitted.
 *
 * The AssetServerPlugin requires this option and creates `<assetUploadDir>/cache` on startup,
 * even when a custom storage strategy is used. No asset is ever stored there by this package.
 */
export const DEFAULT_ASSET_UPLOAD_DIR = join(tmpdir(), 'vendure-factorydrive-assets')

/** Upper bound for asset keys echoed in logs and error messages (keys can come from request URLs). */
export const MAX_LOGGED_KEY_LENGTH = 256
