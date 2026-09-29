// Copyright 2026 FicSys
// SPDX-License-Identifier: Apache-2.0

import { Readable } from 'node:stream'
import { buffer as consumeToBuffer, text as consumeToText } from 'node:stream/consumers'
import { Logger } from '@vendure/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStrategy } from './helpers/factorydrive'

describe('FactorydriveAssetStorageStrategy operations', () => {
  beforeEach(() => {
    vi.spyOn(Logger, 'debug').mockImplementation(() => undefined)
    vi.spyOn(Logger, 'verbose').mockImplementation(() => undefined)
    vi.spyOn(Logger, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('writeFileFromBuffer', () => {
    it('puts the buffer on the disk and returns the normalised key as identifier', async () => {
      const { strategy, disk } = await createStrategy()
      const data = Buffer.from('png-bytes')

      const identifier = await strategy.writeFileFromBuffer('source/ab/image.png', data)

      expect(identifier).toBe('source/ab/image.png')
      expect(disk('assets').files.get('source/ab/image.png')).toEqual(data)
      // No copy: the exact Buffer instance reaches the driver.
      expect(disk('assets').puts[0].content).toBe(data)
    })

    it('normalises Windows-style names produced by path.join', async () => {
      const { strategy, disk } = await createStrategy()

      const identifier = await strategy.writeFileFromBuffer('\\preview\\cd\\image__preview.png', Buffer.from('x'))

      expect(identifier).toBe('preview/cd/image__preview.png')
      expect(disk('assets').files.has('preview/cd/image__preview.png')).toBe(true)
    })
  })

  describe('writeFileFromStream', () => {
    it('hands the very same Readable to disk.put() without buffering it', async () => {
      const { strategy, disk } = await createStrategy()
      const chunks = ['chunk-1|', 'chunk-2|', 'chunk-3']
      const stream = Readable.from(chunks.map((chunk) => Buffer.from(chunk)))

      const identifier = await strategy.writeFileFromStream('source/ab/large.bin', stream)

      expect(identifier).toBe('source/ab/large.bin')
      const [put] = disk('assets').puts
      expect(put.receivedStream).toBe(true)
      expect(put.content).toBe(stream)
      expect(disk('assets').files.get('source/ab/large.bin')?.toString()).toBe(chunks.join(''))
    })

    it('streams a large generated payload chunk by chunk', async () => {
      const { strategy, disk } = await createStrategy()
      const chunkSize = 64 * 1024
      const chunkCount = 64
      async function* generate() {
        for (let index = 0; index < chunkCount; index++) {
          yield Buffer.alloc(chunkSize, index % 256)
        }
      }

      await strategy.writeFileFromStream('source/xx/big.bin', Readable.from(generate()))

      const stored = disk('assets').files.get('source/xx/big.bin')
      expect(stored?.length).toBe(chunkSize * chunkCount)
      expect(stored?.[chunkSize * 10]).toBe(10)
    })

    it('wraps legacy duck-typed streams so drivers still receive a Readable', async () => {
      const { strategy, disk } = await createStrategy()
      const inner = Readable.from([Buffer.from('legacy')])
      const legacy = {
        pipe: inner.pipe.bind(inner),
        on: inner.on.bind(inner),
        once: inner.once.bind(inner),
        removeListener: inner.removeListener.bind(inner),
        emit: inner.emit.bind(inner),
        pause: inner.pause.bind(inner),
        resume: inner.resume.bind(inner),
        read: inner.read.bind(inner),
      }

      // biome-ignore lint/suspicious/noExplicitAny: deliberately passing a non-Readable stream-like object.
      await strategy.writeFileFromStream('source/xx/legacy.txt', legacy as any)

      expect(disk('assets').puts[0].receivedStream).toBe(true)
      expect(disk('assets').files.get('source/xx/legacy.txt')?.toString()).toBe('legacy')
    })

    it('rejects a stream that was already consumed', async () => {
      const { strategy, disk } = await createStrategy()
      const stream = Readable.from([Buffer.from('once')])
      await consumeToBuffer(stream)

      await expect(strategy.writeFileFromStream('source/xx/consumed.bin', stream)).rejects.toThrow(/no longer readable/)
      expect(disk('assets').puts).toHaveLength(0)
    })

    it('rejects values that are not streams', async () => {
      const { strategy } = await createStrategy()
      // biome-ignore lint/suspicious/noExplicitAny: deliberately passing an invalid value.
      await expect(strategy.writeFileFromStream('source/xx/nope.bin', {} as any)).rejects.toThrow(/expects a Node.js readable stream/)
    })

    it('reports the source stream error and removes the partial file', async () => {
      const { strategy, disk } = await createStrategy()
      const uploadLimit = new Error('File truncated as it exceeds the byte size limit')
      async function* failing() {
        yield Buffer.from('partial')
        throw uploadLimit
      }
      const assets = disk('assets')
      const originalPut = assets.put.bind(assets)
      // Simulate a driver that writes what it received before failing (like the local driver's pipeline).
      vi.spyOn(assets, 'put').mockImplementation(async (location, content) => {
        assets.files.set(location, Buffer.from('partial'))
        return originalPut(location, content)
      })

      await expect(strategy.writeFileFromStream('source/xx/partial.bin', Readable.from(failing()))).rejects.toBe(uploadLimit)
      expect(assets.files.has('source/xx/partial.bin')).toBe(false)
    })
  })

  describe('readFileToBuffer', () => {
    it('returns the stored content', async () => {
      const { strategy } = await createStrategy()
      const identifier = await strategy.writeFileFromBuffer('source/ab/read.txt', Buffer.from('hello assets'))

      await expect(strategy.readFileToBuffer(identifier)).resolves.toEqual(Buffer.from('hello assets'))
    })

    it('accepts the leading-separator keys built by the /assets route', async () => {
      const { strategy } = await createStrategy()
      await strategy.writeFileFromBuffer('source/ab/read.txt', Buffer.from('route'))

      await expect(strategy.readFileToBuffer('/source/ab/read.txt')).resolves.toEqual(Buffer.from('route'))
      await expect(strategy.readFileToBuffer('\\source\\ab\\read.txt')).resolves.toEqual(Buffer.from('route'))
    })

    it('rejects when the file is missing (the AssetServerPlugin relies on it to detect cache misses)', async () => {
      const { strategy } = await createStrategy()

      await expect(strategy.readFileToBuffer('cache/source/ab/missing.webp')).rejects.toMatchObject({ code: 'E_FILE_NOT_FOUND' })
      expect(Logger.debug).toHaveBeenCalledTimes(1)
      expect(Logger.error).not.toHaveBeenCalled()
    })
  })

  describe('readFileToStream', () => {
    it('returns a stream that can be fully consumed', async () => {
      const { strategy } = await createStrategy()
      const content = 'streamed content that spans several chunks'
      await strategy.writeFileFromBuffer('source/ab/stream.txt', Buffer.from(content))

      const stream = await strategy.readFileToStream('source/ab/stream.txt')

      await expect(consumeToText(stream as Readable)).resolves.toBe(content)
    })

    it('applies the requested encoding', async () => {
      const { strategy } = await createStrategy()
      await strategy.writeFileFromBuffer('source/ab/encoded.txt', Buffer.from('abc'))

      const stream = (await strategy.readFileToStream('source/ab/encoded.txt', 'hex')) as Readable
      const chunks: string[] = []
      for await (const chunk of stream) {
        chunks.push(chunk as string)
      }

      expect(chunks.join('')).toBe('616263')
    })
  })

  describe('deleteFile', () => {
    it('removes the file', async () => {
      const { strategy, disk } = await createStrategy()
      await strategy.writeFileFromBuffer('source/ab/delete.txt', Buffer.from('x'))

      await strategy.deleteFile('source/ab/delete.txt')

      expect(disk('assets').files.has('source/ab/delete.txt')).toBe(false)
      await expect(strategy.fileExists('source/ab/delete.txt')).resolves.toBe(false)
    })

    it('is idempotent when the file is already gone', async () => {
      const { strategy, disk } = await createStrategy()
      const assets = disk('assets')
      vi.spyOn(assets, 'delete').mockRejectedValueOnce(Object.assign(new Error('gone'), { code: 'E_FILE_NOT_FOUND' }))

      await expect(strategy.deleteFile('source/ab/already-gone.txt')).resolves.toBeUndefined()
      await expect(strategy.deleteFile('source/ab/never-existed.txt')).resolves.toBeUndefined()
    })
  })

  describe('fileExists', () => {
    it('returns true for an existing file and false otherwise', async () => {
      const { strategy } = await createStrategy()
      await strategy.writeFileFromBuffer('source/ab/exists.txt', Buffer.from('x'))

      await expect(strategy.fileExists('source/ab/exists.txt')).resolves.toBe(true)
      await expect(strategy.fileExists('source/ab/missing.txt')).resolves.toBe(false)
    })
  })

  describe('disk selection', () => {
    it('only touches the configured disk', async () => {
      const { strategy, disk } = await createStrategy({ disk: 'documents' })

      await strategy.writeFileFromBuffer('source/ab/doc.pdf', Buffer.from('pdf'))

      expect(disk('documents').files.has('source/ab/doc.pdf')).toBe(true)
      expect(disk('assets').files.size).toBe(0)
    })

    it('uses the Factorydrive default disk when no disk is configured', async () => {
      const { strategy, disk } = await createStrategy({})

      await strategy.writeFileFromBuffer('source/ab/default.png', Buffer.from('default'))

      expect(disk().files.has('source/ab/default.png')).toBe(true)
      expect(disk('assets').files.has('source/ab/default.png')).toBe(true)
      expect(disk('documents').files.size).toBe(0)
    })
  })
})
