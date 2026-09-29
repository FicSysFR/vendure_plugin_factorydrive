// Copyright 2026 FicSys
// SPDX-License-Identifier: Apache-2.0

import { Logger } from '@vendure/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FactorydriveAssetConfigurationError } from '../../src/errors'
import { FactorydriveAssetStorageStrategy } from '../../src/factorydrive-asset-storage-strategy'
import { assetsAndDocuments, createFactorydrive, injectorFor } from './helpers/factorydrive'
import { type MemoryStorage, NoDeleteStorage, NoStreamStorage } from './helpers/memory-storage'

describe('FactorydriveAssetStorageStrategy lifecycle', () => {
  beforeEach(() => {
    vi.spyOn(Logger, 'verbose').mockImplementation(() => undefined)
    vi.spyOn(Logger, 'warn').mockImplementation(() => undefined)
    vi.spyOn(Logger, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('validates the disk option when constructed', () => {
    expect(() => new FactorydriveAssetStorageStrategy({ disk: '' })).toThrow(FactorydriveAssetConfigurationError)
    // biome-ignore lint/suspicious/noExplicitAny: runtime validation for JavaScript callers.
    expect(() => new FactorydriveAssetStorageStrategy({ disk: 42 as any })).toThrow(/non-empty string/)
  })

  it('refuses to run operations before init(injector)', async () => {
    const strategy = new FactorydriveAssetStorageStrategy({ disk: 'assets' })

    await expect(strategy.writeFileFromBuffer('source/a.png', Buffer.from('x'))).rejects.toThrow(/not initialised/)
    await expect(strategy.fileExists('source/a.png')).rejects.toBeInstanceOf(FactorydriveAssetConfigurationError)
  })

  it('explains how to fix a missing FactorydriveModule', async () => {
    const strategy = new FactorydriveAssetStorageStrategy({ disk: 'assets' })

    const failure = strategy.init(injectorFor(undefined))

    await expect(failure).rejects.toBeInstanceOf(FactorydriveAssetConfigurationError)
    await expect(failure).rejects.toThrow(/FactorydriveModule\.forRoot/)
  })

  it('fails at bootstrap when the disk does not exist', async () => {
    const factorydrive = await createFactorydrive(assetsAndDocuments)
    const strategy = new FactorydriveAssetStorageStrategy({ disk: 'backups' })

    await expect(strategy.init(injectorFor(factorydrive))).rejects.toThrow(/disk "backups" could not be resolved/)
  })

  it('fails at bootstrap when no disk is configured and Factorydrive has no default disk', async () => {
    const factorydrive = await createFactorydrive({ disks: { assets: { driver: 'memory', config: {} } } })
    const strategy = new FactorydriveAssetStorageStrategy()

    await expect(strategy.init(injectorFor(factorydrive))).rejects.toThrow(/disk \(default\) could not be resolved/)
  })

  it('fails at bootstrap when the driver lacks an operation Vendure needs', async () => {
    const factorydrive = await createFactorydrive({ default: 'assets', disks: { assets: { driver: 'nodelete', config: {} } } }, { nodelete: NoDeleteStorage })
    const strategy = new FactorydriveAssetStorageStrategy({ disk: 'assets' })

    await expect(strategy.init(injectorFor(factorydrive))).rejects.toThrow(/does not implement delete/)
  })

  it('only warns when the driver cannot stream reads', async () => {
    const factorydrive = await createFactorydrive({ default: 'assets', disks: { assets: { driver: 'nostream', config: {} } } }, { nostream: NoStreamStorage })
    const strategy = new FactorydriveAssetStorageStrategy({ disk: 'assets' })

    await strategy.init(injectorFor(factorydrive))

    expect(Logger.warn).toHaveBeenCalledWith(expect.stringContaining('does not implement getStream'), 'FactorydriveAssetStorage')
    await expect(strategy.readFileToStream('source/a.png')).rejects.toMatchObject({ name: 'MethodNotSupportedException' })
  })

  it('can be initialised more than once (the Vendure test server bootstraps twice)', async () => {
    const first = await createFactorydrive(assetsAndDocuments)
    const second = await createFactorydrive(assetsAndDocuments)
    const strategy = new FactorydriveAssetStorageStrategy({ disk: 'assets' })

    await strategy.init(injectorFor(first))
    await strategy.init(injectorFor(second))
    await strategy.writeFileFromBuffer('source/a.png', Buffer.from('x'))

    expect(second.getDisk<MemoryStorage>('assets').files.has('source/a.png')).toBe(true)
    expect(first.getDisk<MemoryStorage>('assets').files.size).toBe(0)
  })

  it('drops the disk reference on destroy() without touching the Factorydrive disk', async () => {
    const factorydrive = await createFactorydrive(assetsAndDocuments)
    const strategy = new FactorydriveAssetStorageStrategy({ disk: 'assets' })
    await strategy.init(injectorFor(factorydrive))
    await strategy.writeFileFromBuffer('source/a.png', Buffer.from('x'))

    strategy.destroy()

    await expect(strategy.readFileToBuffer('source/a.png')).rejects.toThrow(/not initialised/)
    expect(factorydrive.getDisk<MemoryStorage>('assets').files.has('source/a.png')).toBe(true)
  })

  it('only exposes toAbsoluteUrl when a URL function is provided', () => {
    expect(new FactorydriveAssetStorageStrategy({ disk: 'assets' }).toAbsoluteUrl).toBeUndefined()
    const toAbsoluteUrl = () => 'https://cdn.example.com/x'
    expect(new FactorydriveAssetStorageStrategy({ disk: 'assets' }, toAbsoluteUrl).toAbsoluteUrl).toBe(toAbsoluteUrl)
  })
})
