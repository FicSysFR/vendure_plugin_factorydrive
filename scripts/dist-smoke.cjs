#!/usr/bin/env node
// Copyright 2026 FicSys
// SPDX-License-Identifier: Apache-2.0

/**
 * Smoke test of the compiled package, loaded the way a CommonJS Vendure app loads it.
 */
const assert = require('node:assert/strict')
const { tmpdir } = require('node:os')
const packageJson = require('../package.json')
const api = require('../dist')

for (const name of ['FactorydriveAssetPlugin', 'FactorydriveAssetStorageStrategy', 'configureFactorydriveAssetStorage', 'normalizeAssetKey', 'FactorydriveAssetKeyError']) {
  assert.equal(typeof api[name], 'function', `missing export ${name}`)
}

// The package must not pull any storage provider SDK: drivers are chosen by the application.
assert.deepEqual(Object.keys(packageJson.dependencies ?? {}), [], 'the package must not have runtime dependencies')
for (const peer of ['@vendure/core', '@vendure/asset-server-plugin', '@ficsysfr/nestjs_module_factorydrive']) {
  assert.ok(packageJson.peerDependencies[peer], `missing peer dependency ${peer}`)
}

const factory = api.configureFactorydriveAssetStorage({ disk: 'assets' })
const strategy = factory({ route: 'assets', assetUploadDir: tmpdir(), assetUrlPrefix: 'https://api.example.com/assets/' })
assert.ok(strategy instanceof api.FactorydriveAssetStorageStrategy)
assert.equal(strategy.toAbsoluteUrl({}, 'source/ab/image.png'), 'https://api.example.com/assets/source/ab/image.png')
assert.equal(api.normalizeAssetKey('\\source\\ab\\image.png'), 'source/ab/image.png')

console.log(`dist smoke test passed (${packageJson.name}@${packageJson.version})`)
