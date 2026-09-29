// Copyright 2026 FicSys
// SPDX-License-Identifier: Apache-2.0

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { StorageManagerConfig } from '@ficsysfr/nestjs_module_factorydrive'
import { Logger } from '@vendure/core'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { FactorydriveAssetStorageStrategy } from '../../src/factorydrive-asset-storage-strategy'
import { createFactorydrive, injectorFor } from './helpers/factorydrive'

/**
 * Vendure runs the API server and the worker in separate processes, each with its own
 * FactorydriveService. With a shared disk, what one process writes must be visible to the other.
 */
describe('server and worker sharing one Factorydrive disk (local driver)', () => {
  let root: string
  let outside: string

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'vendure-factorydrive-shared-'))
    outside = await mkdtemp(join(tmpdir(), 'vendure-factorydrive-outside-'))
    await writeFile(join(outside, 'secret.txt'), 'top secret')
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })

  beforeEach(() => {
    vi.spyOn(Logger, 'verbose').mockImplementation(() => undefined)
    vi.spyOn(Logger, 'debug').mockImplementation(() => undefined)
    vi.spyOn(Logger, 'error').mockImplementation(() => undefined)
  })

  async function createProcess() {
    const config: StorageManagerConfig = { default: 'assets', disks: { assets: { driver: 'local', config: { root } } } }
    const factorydrive = await createFactorydrive(config, {})
    const strategy = new FactorydriveAssetStorageStrategy({ disk: 'assets' })
    await strategy.init(injectorFor(factorydrive))
    return strategy
  }

  it('lets the worker read, check and delete what the server wrote', async () => {
    const server = await createProcess()
    const worker = await createProcess()

    const identifier = await server.writeFileFromStream('source\\ab\\shared.bin', Readable.from([Buffer.from('shared '), Buffer.from('bytes')]))

    expect(identifier).toBe('source/ab/shared.bin')
    await expect(readFile(join(root, 'source', 'ab', 'shared.bin'), 'utf8')).resolves.toBe('shared bytes')
    await expect(worker.fileExists(identifier)).resolves.toBe(true)
    await expect(worker.readFileToBuffer(identifier)).resolves.toEqual(Buffer.from('shared bytes'))

    await worker.deleteFile(identifier)
    await expect(server.fileExists(identifier)).resolves.toBe(false)
    await expect(server.deleteFile(identifier)).resolves.toBeUndefined()
  })

  it('never reads outside the disk root', async () => {
    const server = await createProcess()
    const relativeToRoot = join('..', outside.split(/[\\/]/).pop() ?? '', 'secret.txt')

    await expect(server.readFileToBuffer(relativeToRoot)).rejects.toThrow()
    await expect(server.readFileToBuffer(`/${relativeToRoot.replace(/\\/g, '/')}`)).rejects.toThrow()
  })

  it('reports a missing file as a rejected read', async () => {
    const server = await createProcess()

    await expect(server.readFileToBuffer('cache/source/ab/missing.webp')).rejects.toMatchObject({ code: 'E_FILE_NOT_FOUND' })
  })
})
