// Copyright 2026 FicSys
// SPDX-License-Identifier: Apache-2.0

import { Readable } from 'node:stream'
import {
  AbstractStorage,
  type ContentResponse,
  type DeleteResponse,
  type ExistsResponse,
  FileNotFoundException,
  isReadableStream,
  type Response as StorageResponse,
} from '@ficsysfr/nestjs_module_factorydrive'

export interface MemoryStorageConfig {
  /** Disks created with the same volume name share their files (simulates shared storage). */
  volume?: string
}

export interface PutCall {
  location: string
  content: Buffer | NodeJS.ReadableStream | string
  receivedStream: boolean
}

const volumes = new Map<string, Map<string, Buffer>>()

/**
 * In-memory Factorydrive driver used by the unit tests. It records what `put()` receives so
 * tests can assert that streams are handed over untouched.
 */
export class MemoryStorage extends AbstractStorage {
  public readonly files: Map<string, Buffer>
  public readonly puts: PutCall[] = []
  public readonly config: MemoryStorageConfig

  public constructor(config: MemoryStorageConfig = {}) {
    super()
    this.config = config
    if (config.volume) {
      const volume = volumes.get(config.volume) ?? new Map<string, Buffer>()
      volumes.set(config.volume, volume)
      this.files = volume
    } else {
      this.files = new Map<string, Buffer>()
    }
  }

  public static resetVolumes(): void {
    volumes.clear()
  }

  public override onStorageInit(): void {}

  public override async put(location: string, content: Buffer | NodeJS.ReadableStream | string): Promise<StorageResponse> {
    const receivedStream = isReadableStream(content)
    this.puts.push({ location, content, receivedStream })
    if (receivedStream) {
      const chunks: Buffer[] = []
      for await (const chunk of content as AsyncIterable<Buffer | string>) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      }
      this.files.set(location, Buffer.concat(chunks))
    } else {
      this.files.set(location, Buffer.isBuffer(content) ? content : Buffer.from(content as string))
    }
    return { raw: undefined }
  }

  public override async getBuffer(location: string): Promise<ContentResponse<Buffer>> {
    const file = this.files.get(location)
    if (!file) {
      throw new FileNotFoundException(new Error('ENOENT: no such file'), location)
    }
    return { content: file, raw: undefined }
  }

  public override async getStream(location: string): Promise<NodeJS.ReadableStream> {
    const file = this.files.get(location)
    if (!file) {
      throw new FileNotFoundException(new Error('ENOENT: no such file'), location)
    }
    // Emit in small chunks to exercise real stream consumption.
    const chunks: Buffer[] = []
    for (let offset = 0; offset < file.length; offset += 4) {
      chunks.push(file.subarray(offset, offset + 4))
    }
    return Readable.from(chunks)
  }

  public override async exists(location: string): Promise<ExistsResponse> {
    return { exists: this.files.has(location), raw: undefined }
  }

  public override async delete(location: string): Promise<DeleteResponse> {
    return { wasDeleted: this.files.delete(location), raw: undefined }
  }
}

/** Driver that does not implement getStream (inherits AbstractStorage's synchronous MethodNotSupported throw). */
export class NoStreamStorage extends MemoryStorage {}
Object.defineProperty(NoStreamStorage.prototype, 'getStream', { value: AbstractStorage.prototype.getStream })

/** Driver missing an operation Vendure requires. */
export class NoDeleteStorage extends MemoryStorage {}
Object.defineProperty(NoDeleteStorage.prototype, 'delete', { value: AbstractStorage.prototype.delete })
