// Copyright 2026 FicSys
// SPDX-License-Identifier: Apache-2.0

import { FileNotFoundException } from '@ficsysfr/nestjs_module_factorydrive'
import { FactorydriveAssetKeyError } from './asset-key'

/**
 * Thrown when the strategy cannot be wired to Factorydrive: missing `FactorydriveModule`,
 * unknown disk, or a driver that lacks an operation Vendure needs.
 */
export class FactorydriveAssetConfigurationError extends Error {
  public override readonly name = 'FactorydriveAssetConfigurationError'
}

const NOT_FOUND_CODES = new Set(['E_FILE_NOT_FOUND', 'ENOENT'])
const NOT_A_FILE_CODES = new Set(['EISDIR', 'ENOTDIR'])
const MAX_SUMMARY_LENGTH = 300

interface ErrorLike {
  name?: unknown
  code?: unknown
  message?: unknown
  raw?: unknown
}

function asErrorLike(error: unknown): ErrorLike {
  return typeof error === 'object' && error !== null ? (error as ErrorLike) : {}
}

function stringProperty(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * `true` when a Factorydrive (or raw Node) error means "this file does not exist".
 *
 * The `code` check keeps working when the application accidentally ends up with a second
 * copy of Factorydrive, where `instanceof` would silently fail.
 */
export function isFileNotFound(error: unknown): boolean {
  if (error instanceof FileNotFoundException) {
    return true
  }
  const code = asErrorLike(error).code
  return typeof code === 'string' && NOT_FOUND_CODES.has(code)
}

/**
 * `true` for errors that, on the read path, only mean "nothing to serve at this key":
 * missing files, keys that designate a directory, and keys rejected by validation.
 */
export function isExpectedReadMiss(error: unknown): boolean {
  if (isFileNotFound(error) || error instanceof FactorydriveAssetKeyError) {
    return true
  }
  const { code, raw } = asErrorLike(error)
  const rawCode = asErrorLike(raw).code
  return (typeof code === 'string' && NOT_A_FILE_CODES.has(code)) || (typeof rawCode === 'string' && NOT_A_FILE_CODES.has(rawCode))
}

/**
 * One-line, bounded description of an error that is safe to log.
 *
 * Only the error name, code and the first line of its message are kept, plus the name/code
 * of the provider error wrapped by Factorydrive. The provider error object itself (`raw`),
 * which can carry request metadata, is never serialised.
 */
export function safeErrorSummary(error: unknown): string {
  const { name, code, message, raw } = asErrorLike(error)
  const firstLine = (stringProperty(message) ?? String(error)).split('\n')[0].trim()
  const parts = [`${stringProperty(name) ?? 'Error'}${stringProperty(code) ? ` [${code}]` : ''}: ${firstLine}`]

  const rawLike = asErrorLike(raw)
  const rawName = stringProperty(rawLike.name)
  const rawCode = stringProperty(rawLike.code)
  if (rawName || rawCode) {
    parts.push(`(provider error: ${[rawName, rawCode].filter(Boolean).join(' ')})`)
  }

  const summary = parts.join(' ')
  return summary.length > MAX_SUMMARY_LENGTH ? `${summary.slice(0, MAX_SUMMARY_LENGTH)}…` : summary
}
