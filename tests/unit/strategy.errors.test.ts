// Copyright 2026 FicSys
// SPDX-License-Identifier: Apache-2.0

import { NoSuchBucketException, PermissionMissingException, UnknownException } from '@ficsysfr/nestjs_module_factorydrive'
import { Logger } from '@vendure/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FactorydriveAssetKeyError } from '../../src/asset-key'
import { createStrategy } from './helpers/factorydrive'

function providerError(): Error {
  return Object.assign(new Error('The request signature we calculated does not match'), {
    name: 'SignatureDoesNotMatch',
    Code: 'SignatureDoesNotMatch',
    // Simulates provider metadata that must never reach the logs.
    StringToSign: 'AWS4-HMAC-SHA256 secret-material',
    credentials: { secretAccessKey: 'super-secret-key' },
  })
}

describe('FactorydriveAssetStorageStrategy error handling', () => {
  beforeEach(() => {
    vi.spyOn(Logger, 'debug').mockImplementation(() => undefined)
    vi.spyOn(Logger, 'verbose').mockImplementation(() => undefined)
    vi.spyOn(Logger, 'warn').mockImplementation(() => undefined)
    vi.spyOn(Logger, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('propagates provider errors unchanged and logs disk, operation and key without secrets', async () => {
    const { strategy, disk } = await createStrategy()
    const failure = new UnknownException(providerError(), 'SignatureDoesNotMatch', 'source/ab/a.png')
    vi.spyOn(disk('assets'), 'put').mockRejectedValue(failure)

    await expect(strategy.writeFileFromBuffer('source/ab/a.png', Buffer.from('binary-content'))).rejects.toBe(failure)

    expect(Logger.error).toHaveBeenCalledTimes(1)
    const [message, context] = vi.mocked(Logger.error).mock.calls[0]
    expect(context).toBe('FactorydriveAssetStorage')
    expect(message).toContain('writeFileFromBuffer')
    expect(message).toContain('disk "assets"')
    expect(message).toContain('"source/ab/a.png"')
    expect(message).toContain('UnknownException [E_UNKNOWN]')
    expect(message).toContain('provider error: SignatureDoesNotMatch')
    expect(message).not.toContain('super-secret-key')
    expect(message).not.toContain('secret-material')
    expect(message).not.toContain('binary-content')
  })

  it('does not swallow permission errors on reads', async () => {
    const { strategy, disk } = await createStrategy()
    const failure = new PermissionMissingException(new Error('EPERM'), 'source/ab/a.png')
    vi.spyOn(disk('assets'), 'getBuffer').mockRejectedValue(failure)

    await expect(strategy.readFileToBuffer('source/ab/a.png')).rejects.toBe(failure)
    expect(Logger.error).toHaveBeenCalledWith(expect.stringContaining('PermissionMissingException'), 'FactorydriveAssetStorage', expect.any(String))
  })

  it('does not report provider failures as a missing file in fileExists', async () => {
    const { strategy, disk } = await createStrategy()
    const failure = new NoSuchBucketException(new Error('NoSuchBucket'), 'shop-assets')
    vi.spyOn(disk('assets'), 'exists').mockRejectedValue(failure)

    await expect(strategy.fileExists('source/ab/a.png')).rejects.toBe(failure)
  })

  it('propagates delete failures other than "not found"', async () => {
    const { strategy, disk } = await createStrategy()
    const failure = new PermissionMissingException(new Error('AccessDenied'), 'source/ab/a.png')
    vi.spyOn(disk('assets'), 'delete').mockRejectedValue(failure)

    await expect(strategy.deleteFile('source/ab/a.png')).rejects.toBe(failure)
  })

  it('propagates errors thrown synchronously by a driver', async () => {
    const { strategy, disk } = await createStrategy()
    const failure = new Error('sync failure')
    vi.spyOn(disk('assets'), 'getBuffer').mockImplementation(() => {
      throw failure
    })

    await expect(strategy.readFileToBuffer('source/ab/a.png')).rejects.toBe(failure)
  })

  it('treats "not found" errors from a duplicated Factorydrive copy (matched by code) as cache misses', async () => {
    const { strategy, disk } = await createStrategy()
    const foreignNotFound = Object.assign(new Error('not found'), { name: 'FileNotFoundException', code: 'E_FILE_NOT_FOUND' })
    vi.spyOn(disk('assets'), 'getBuffer').mockRejectedValue(foreignNotFound)

    await expect(strategy.readFileToBuffer('cache/a.png')).rejects.toBe(foreignNotFound)
    expect(Logger.debug).toHaveBeenCalledTimes(1)
    expect(Logger.error).not.toHaveBeenCalled()
  })

  it('treats directory keys on the read path as misses (GET /assets/source)', async () => {
    const { strategy, disk } = await createStrategy()
    const isDirectory = new UnknownException(Object.assign(new Error('EISDIR: illegal operation on a directory'), { code: 'EISDIR' }), 'EISDIR', 'source')
    vi.spyOn(disk('assets'), 'getBuffer').mockRejectedValue(isDirectory)

    await expect(strategy.readFileToBuffer('/source')).rejects.toBe(isDirectory)
    expect(Logger.debug).toHaveBeenCalledTimes(1)
    expect(Logger.error).not.toHaveBeenCalled()
  })

  it('rejects traversal attempts before reaching the driver', async () => {
    const { strategy, disk } = await createStrategy()
    const getBuffer = vi.spyOn(disk('assets'), 'getBuffer')

    await expect(strategy.readFileToBuffer('/../../etc/passwd')).rejects.toBeInstanceOf(FactorydriveAssetKeyError)
    await expect(strategy.writeFileFromBuffer('source/../../escape.png', Buffer.from('x'))).rejects.toBeInstanceOf(FactorydriveAssetKeyError)

    expect(getBuffer).not.toHaveBeenCalled()
    expect(disk('assets').puts).toHaveLength(0)
    // Invalid keys on the read path are logged quietly: they come from request URLs.
    expect(Logger.debug).toHaveBeenCalledTimes(1)
    expect(Logger.error).toHaveBeenCalledTimes(1)
  })

  it('escapes and truncates attacker-controlled keys in logs', async () => {
    const { strategy } = await createStrategy()
    const longKey = `cache/${'a'.repeat(400)}\u001b[31m.png`

    await expect(strategy.readFileToBuffer(longKey)).rejects.toBeInstanceOf(FactorydriveAssetKeyError)

    const [message] = vi.mocked(Logger.debug).mock.calls[0]
    expect(message).not.toContain('\u001b')
    expect(message).toContain('…')
    expect(message.length).toBeLessThan(900)
  })

  it('logs a warning when a partial write cannot be cleaned up, and still reports the original error', async () => {
    const { strategy, disk } = await createStrategy()
    const writeFailure = new UnknownException(new Error('socket hang up'), 'ECONNRESET', 'source/ab/a.bin')
    vi.spyOn(disk('assets'), 'put').mockRejectedValue(writeFailure)
    vi.spyOn(disk('assets'), 'delete').mockRejectedValue(new PermissionMissingException(new Error('AccessDenied'), 'source/ab/a.bin'))
    const { Readable } = await import('node:stream')

    await expect(strategy.writeFileFromStream('source/ab/a.bin', Readable.from([Buffer.from('x')]))).rejects.toBe(writeFailure)
    expect(Logger.warn).toHaveBeenCalledWith(expect.stringContaining('Could not remove partially written key'), 'FactorydriveAssetStorage')
  })
})
