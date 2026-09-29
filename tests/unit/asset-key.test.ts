// Copyright 2026 FicSys
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { describeKey, FactorydriveAssetKeyError, normalizeAssetKey } from '../../src/asset-key'

describe('normalizeAssetKey', () => {
  it.each([
    ['source/ab/image.jpg', 'source/ab/image.jpg'],
    ['/source/ab/image.jpg', 'source/ab/image.jpg'],
    ['source\\ab\\image.jpg', 'source/ab/image.jpg'],
    ['\\cache\\source\\ab\\image5d41402abc4b2a76b9719d911017c592.webp', 'cache/source/ab/image5d41402abc4b2a76b9719d911017c592.webp'],
    ['source//ab/./image.jpg', 'source/ab/image.jpg'],
    ['image.jpg', 'image.jpg'],
    ['source/ab/image..jpg', 'source/ab/image..jpg'],
    ['source/ab/...', 'source/ab/...'],
    ['preview/71/ünïcödé__preview.png', 'preview/71/ünïcödé__preview.png'],
  ])('normalises %j to %j', (input, expected) => {
    expect(normalizeAssetKey(input)).toBe(expected)
  })

  it.each([
    ['', /non-empty string/],
    ['../secret.txt', /parent directory/],
    ['source/../../etc/passwd', /parent directory/],
    ['..\\..\\windows\\win.ini', /parent directory/],
    ['source/..', /parent directory/],
    ['\\\\server\\share\\file.jpg', /UNC path/],
    ['//server/share/file.jpg', /UNC path/],
    ['C:/Windows/win.ini', /drive letter/],
    ['source/c:evil.jpg', /drive letter/],
    ['source/ab/image.jpg\u0000.png', /control characters/],
    ['source/ab/\nimage.jpg', /control characters/],
    ['source/ab/\u007fimage.jpg', /control characters/],
    ['/', /does not designate a file/],
    ['./.', /does not designate a file/],
  ])('rejects %j', (input, message) => {
    expect(() => normalizeAssetKey(input)).toThrow(FactorydriveAssetKeyError)
    expect(() => normalizeAssetKey(input)).toThrow(message)
  })

  it('rejects non-string values', () => {
    expect(() => normalizeAssetKey(undefined)).toThrow(FactorydriveAssetKeyError)
    expect(() => normalizeAssetKey(42)).toThrow(FactorydriveAssetKeyError)
  })
})

describe('describeKey', () => {
  it('JSON-escapes keys and caps their length', () => {
    expect(describeKey('a\nb')).toBe('"a\\nb"')
    expect(describeKey(undefined)).toBe('"undefined"')
    expect(describeKey('x'.repeat(300))).toHaveLength(256 + 3)
  })
})
