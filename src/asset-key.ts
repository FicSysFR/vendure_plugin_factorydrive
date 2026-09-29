// Copyright 2026 FicSys
// SPDX-License-Identifier: Apache-2.0

import { MAX_LOGGED_KEY_LENGTH } from './constants'

/**
 * Thrown when Vendure hands the storage strategy a file name or identifier that cannot be
 * safely mapped to a Factorydrive location (path traversal, control characters, absolute paths...).
 *
 * On the read path the AssetServerPlugin turns any error into a 404, so a rejected key never
 * reaches the storage provider.
 */
export class FactorydriveAssetKeyError extends Error {
  public override readonly name = 'FactorydriveAssetKeyError'
}

const DRIVE_LETTER_SEGMENT = /^[a-zA-Z]:/

/**
 * Returns a printable, bounded representation of an untrusted key for logs and error messages.
 */
export function describeKey(key: unknown): string {
  const printable = typeof key === 'string' ? key : String(key)
  const truncated = printable.length > MAX_LOGGED_KEY_LENGTH ? `${printable.slice(0, MAX_LOGGED_KEY_LENGTH)}…` : printable
  return JSON.stringify(truncated)
}

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code < 0x20 || code === 0x7f) {
      return true
    }
  }
  return false
}

/**
 * Converts a Vendure file name / identifier into a canonical Factorydrive location.
 *
 * Vendure builds names with `path.join` / `path.normalize`, so on Windows they contain
 * backslashes, and keys derived from `/assets/...` requests start with a separator.
 * Every key is therefore normalised to a relative, forward-slash location:
 *
 * - `\` becomes `/`, leading separators, empty and `.` segments are removed;
 * - control characters, UNC paths, `..` segments and drive letters are rejected.
 *
 * The same normalised key is returned to Vendure as the asset identifier, which keeps
 * identifiers portable across operating systems and storage providers.
 */
export function normalizeAssetKey(input: unknown): string {
  if (typeof input !== 'string' || input.length === 0) {
    throw new FactorydriveAssetKeyError('Asset key must be a non-empty string')
  }
  if (hasControlCharacters(input)) {
    throw new FactorydriveAssetKeyError(`Asset key ${describeKey(input)} contains control characters`)
  }
  if (/^[\\/]{2}/.test(input)) {
    throw new FactorydriveAssetKeyError(`Asset key ${describeKey(input)} looks like a UNC path`)
  }

  const segments: string[] = []
  for (const segment of input.replace(/\\/g, '/').split('/')) {
    if (segment === '' || segment === '.') {
      continue
    }
    if (segment === '..') {
      throw new FactorydriveAssetKeyError(`Asset key ${describeKey(input)} contains a parent directory segment`)
    }
    if (DRIVE_LETTER_SEGMENT.test(segment)) {
      throw new FactorydriveAssetKeyError(`Asset key ${describeKey(input)} contains a drive letter`)
    }
    segments.push(segment)
  }

  if (segments.length === 0) {
    throw new FactorydriveAssetKeyError(`Asset key ${describeKey(input)} does not designate a file`)
  }
  return segments.join('/')
}
