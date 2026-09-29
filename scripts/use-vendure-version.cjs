#!/usr/bin/env node
// Copyright 2026 FicSys
// SPDX-License-Identifier: Apache-2.0

/**
 * Pins the Vendure packages used by the tests to one version (CI compatibility matrix).
 *
 *   node scripts/use-vendure-version.cjs 3.0.8 && yarn install
 *
 * @vendure/testing deep-imports @vendure/core internals and must match it exactly, and a single
 * @vendure/common must be installed, hence the resolution.
 */
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const version = process.argv[2]
if (!version || !/^\d+\.\d+\.\d+(-[\w.-]+)?$/.test(version)) {
  console.error('Usage: node scripts/use-vendure-version.cjs <exact vendure version>')
  process.exit(1)
}

const packageJsonPath = join(__dirname, '..', 'package.json')
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))

for (const name of ['@vendure/core', '@vendure/asset-server-plugin', '@vendure/testing']) {
  packageJson.devDependencies[name] = version
}
packageJson.resolutions = { ...packageJson.resolutions, '@vendure/common': version }

writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)
console.log(`Vendure test dependencies pinned to ${version}`)
