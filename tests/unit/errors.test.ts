// Copyright 2026 FicSys
// SPDX-License-Identifier: Apache-2.0

import { FileNotFoundException, UnknownException } from '@ficsysfr/nestjs_module_factorydrive'
import { describe, expect, it } from 'vitest'
import { FactorydriveAssetKeyError } from '../../src/asset-key'
import { isExpectedReadMiss, isFileNotFound, safeErrorSummary } from '../../src/errors'

describe('isFileNotFound', () => {
  it('recognises Factorydrive and raw Node "not found" errors', () => {
    expect(isFileNotFound(new FileNotFoundException(new Error('ENOENT'), 'a.png'))).toBe(true)
    expect(isFileNotFound(Object.assign(new Error('x'), { code: 'E_FILE_NOT_FOUND' }))).toBe(true)
    expect(isFileNotFound(Object.assign(new Error('x'), { code: 'ENOENT' }))).toBe(true)
    expect(isFileNotFound(new Error('boom'))).toBe(false)
    expect(isFileNotFound(undefined)).toBe(false)
    expect(isFileNotFound('ENOENT')).toBe(false)
  })
})

describe('isExpectedReadMiss', () => {
  it('covers missing files, directories and invalid keys only', () => {
    expect(isExpectedReadMiss(new FileNotFoundException(new Error('ENOENT'), 'a.png'))).toBe(true)
    expect(isExpectedReadMiss(new FactorydriveAssetKeyError('bad key'))).toBe(true)
    expect(isExpectedReadMiss(Object.assign(new Error('x'), { code: 'EISDIR' }))).toBe(true)
    expect(isExpectedReadMiss(new UnknownException(Object.assign(new Error('x'), { code: 'ENOTDIR' }), 'ENOTDIR', 'a'))).toBe(true)
    expect(isExpectedReadMiss(new UnknownException(Object.assign(new Error('x'), { code: 'ECONNRESET' }), 'ECONNRESET', 'a'))).toBe(false)
  })
})

describe('safeErrorSummary', () => {
  it('keeps the name, code and first message line only', () => {
    const summary = safeErrorSummary(new UnknownException(new Error('socket hang up'), 'ECONNRESET', 'source/a.png'))

    expect(summary).toMatch(/^UnknownException \[E_UNKNOWN\]: E_UNKNOWN: An unknown error happened with the file source\/a\.png\./)
    expect(summary).not.toContain('\n')
    expect(summary).not.toContain('Original stack')
  })

  it('handles non-error values and bounds the length', () => {
    expect(safeErrorSummary('plain string')).toBe('Error: plain string')
    expect(safeErrorSummary(new Error('x'.repeat(1000))).length).toBeLessThanOrEqual(301)
  })
})
