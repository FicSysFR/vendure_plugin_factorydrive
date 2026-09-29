// Copyright 2026 FicSys
// SPDX-License-Identifier: Apache-2.0

import { mkdirSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { VENDURE_VERSION } from '@vendure/core'
import { registerInitializer, SqljsInitializer } from '@vendure/testing'

/**
 * Registers the sql.js initializer with a data directory per Vendure version: the cached
 * `.sqlite` files are schema-specific and must not leak between CI matrix entries.
 */
export function registerSqljs(): void {
  const dataDir = join(__dirname, '..', '__data__', VENDURE_VERSION)
  mkdirSync(dataDir, { recursive: true })
  registerInitializer('sqljs', new SqljsInitializer(dataDir))
}

/** `true` when the running Vendure version is at least `major.minor.patch`. */
export function vendureAtLeast(version: string): boolean {
  const current = VENDURE_VERSION.split(/[.-]/).slice(0, 3).map(Number)
  const wanted = version.split('.').map(Number)
  for (let index = 0; index < 3; index++) {
    if (current[index] !== wanted[index]) {
      return current[index] > wanted[index]
    }
  }
  return true
}

/** Lists every file below `root`, as forward-slash keys relative to it. */
export async function listKeys(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true }).catch(() => [])
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort()
}
