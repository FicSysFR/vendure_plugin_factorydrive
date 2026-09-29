// Copyright 2026 FicSys
// SPDX-License-Identifier: Apache-2.0

import { Readable, Stream } from 'node:stream'
import { AbstractStorage, FactorydriveService, isReadableStream } from '@ficsysfr/nestjs_module_factorydrive'
import { type AssetStorageStrategy, type Injector, Logger } from '@vendure/core'
import { describeKey, normalizeAssetKey } from './asset-key'
import { loggerCtx } from './constants'
import { FactorydriveAssetConfigurationError, isExpectedReadMiss, isFileNotFound, safeErrorSummary } from './errors'
import type { FactorydriveAssetStorageOptions, ToAbsoluteUrlFn } from './types'

type Operation = 'writeFileFromBuffer' | 'writeFileFromStream' | 'readFileToBuffer' | 'readFileToStream' | 'deleteFile' | 'fileExists'

/** Disk operations Vendure cannot work without. */
const REQUIRED_OPERATIONS = ['put', 'getBuffer', 'exists', 'delete'] as const satisfies ReadonlyArray<keyof AbstractStorage>

function implementsOperation(disk: AbstractStorage, operation: keyof AbstractStorage): boolean {
  return typeof disk[operation] === 'function' && disk[operation] !== AbstractStorage.prototype[operation]
}

function toNodeReadable(data: Stream): Readable {
  const candidate = data as Partial<Readable>
  if (candidate.destroyed === true || candidate.readable === false) {
    throw new TypeError('writeFileFromStream received a stream that is no longer readable (already consumed or destroyed)')
  }
  if (isReadableStream(data)) {
    return data as Readable
  }
  if (typeof candidate.pipe === 'function' && typeof candidate.on === 'function') {
    // Legacy / duck-typed stream: wrap it so Factorydrive drivers detect it as a stream
    // instead of falling back to their string/Buffer code path.
    return new Readable().wrap(data as unknown as NodeJS.ReadableStream)
  }
  throw new TypeError('writeFileFromStream expects a Node.js readable stream')
}

/**
 * Validates the `disk` option. Kept separate so factories can fail when the Vendure config is
 * built instead of at bootstrap.
 */
export function assertDiskOption(disk: unknown): asserts disk is string | undefined {
  if (disk !== undefined && (typeof disk !== 'string' || disk.trim() === '')) {
    throw new FactorydriveAssetConfigurationError('The "disk" option must be a non-empty string when provided')
  }
}

function toBuffer(content: Buffer | Uint8Array): Buffer {
  return Buffer.isBuffer(content) ? content : Buffer.from(content.buffer, content.byteOffset, content.byteLength)
}

/**
 * Vendure `AssetStorageStrategy` that stores assets on a Factorydrive disk.
 *
 * The strategy is a thin translation layer: it never knows which provider sits behind the disk
 * (local filesystem, S3, RustFS, MinIO, R2, SFTP or a custom driver), never generates public or
 * signed URLs, and leaves routing, previews, transformations and caching to the AssetServerPlugin.
 *
 * `FactorydriveService` is resolved through Nest's DI in {@link init}, which Vendure calls on
 * both the server and the worker once every module is initialised. Use
 * `configureFactorydriveAssetStorage()` (or `FactorydriveAssetPlugin.init()`) rather than
 * instantiating this class directly, so that `toAbsoluteUrl` follows the AssetServerPlugin options.
 */
export class FactorydriveAssetStorageStrategy implements AssetStorageStrategy {
  /**
   * Only defined when a URL function is provided: Vendure checks for its presence once, when
   * the GraphQL asset interceptor is constructed.
   */
  declare public readonly toAbsoluteUrl?: ToAbsoluteUrlFn

  private readonly diskName: string | undefined
  private disk: AbstractStorage | undefined

  public constructor(options: FactorydriveAssetStorageOptions = {}, toAbsoluteUrl?: ToAbsoluteUrlFn) {
    assertDiskOption(options.disk)
    this.diskName = options.disk
    if (toAbsoluteUrl) {
      this.toAbsoluteUrl = toAbsoluteUrl
    }
  }

  /** Disk label used in logs and error messages. */
  private get diskLabel(): string {
    return this.diskName === undefined ? '(default)' : JSON.stringify(this.diskName)
  }

  public async init(injector: Injector): Promise<void> {
    let factorydrive: FactorydriveService | undefined
    try {
      factorydrive = injector.get(FactorydriveService)
    } catch (error) {
      throw new FactorydriveAssetConfigurationError(
        'FactorydriveService could not be resolved. Add FactorydriveModule.forRoot(...) (exactly once) to VendureConfig.plugins, ' +
          'and make sure a single copy of @ficsysfr/nestjs_module_factorydrive is installed (npm ls @ficsysfr/nestjs_module_factorydrive).',
        { cause: error },
      )
    }
    if (!factorydrive) {
      throw new FactorydriveAssetConfigurationError('FactorydriveService could not be resolved from the Vendure injector')
    }

    let disk: AbstractStorage
    try {
      disk = factorydrive.getDisk(this.diskName)
    } catch (error) {
      throw new FactorydriveAssetConfigurationError(`Factorydrive disk ${this.diskLabel} could not be resolved: ${safeErrorSummary(error)}`, { cause: error })
    }

    const missing = REQUIRED_OPERATIONS.filter((operation) => !implementsOperation(disk, operation))
    if (missing.length > 0) {
      throw new FactorydriveAssetConfigurationError(
        `Factorydrive disk ${this.diskLabel} (${disk.constructor.name}) does not implement ${missing.join(', ')}, which Vendure needs to store assets`,
      )
    }
    if (!implementsOperation(disk, 'getStream')) {
      Logger.warn(`Factorydrive disk ${this.diskLabel} (${disk.constructor.name}) does not implement getStream: readFileToStream() will fail`, loggerCtx)
    }

    this.disk = disk
    Logger.verbose(`Vendure assets are stored on Factorydrive disk ${this.diskLabel} (${disk.constructor.name})`, loggerCtx)
  }

  public destroy(): void {
    // The disk belongs to Factorydrive, which owns its lifecycle: only drop the reference.
    this.disk = undefined
  }

  public writeFileFromBuffer(fileName: string, data: Buffer): Promise<string> {
    return this.run('writeFileFromBuffer', fileName, false, async (disk, key) => {
      await disk.put(key, data)
      return key
    })
  }

  /**
   * Hands the incoming stream straight to `disk.put()`: nothing is buffered by this package, so
   * the memory profile of large uploads is the one of the Factorydrive driver in use.
   *
   * The `encoding` argument only matters for text streams and is ignored: assets are binary.
   */
  public writeFileFromStream(fileName: string, data: Stream, _encoding?: BufferEncoding | null): Promise<string> {
    return this.run('writeFileFromStream', fileName, false, async (disk, key) => {
      const source = toNodeReadable(data)

      // Keep the first error of the *source* stream (e.g. an upload size limit or an aborted
      // request) so it is reported instead of the generic error the driver derives from it.
      // The listener is intentionally never removed: a late error on a discarded upload stream
      // must not become an unhandled 'error' event.
      let sourceError: unknown
      source.on('error', (error) => {
        sourceError ??= error
      })

      try {
        await disk.put(key, source)
      } catch (error) {
        if (!source.destroyed) {
          source.destroy()
        }
        await this.removePartialWrite(disk, key)
        throw sourceError ?? error
      }
      if (sourceError) {
        await this.removePartialWrite(disk, key)
        throw sourceError
      }
      return key
    })
  }

  public readFileToBuffer(identifier: string): Promise<Buffer> {
    return this.run('readFileToBuffer', identifier, true, async (disk, key) => {
      const { content } = await disk.getBuffer(key)
      return toBuffer(content)
    })
  }

  /**
   * Returns the driver's stream as-is, without reading it. Some drivers (e.g. the local one)
   * report a missing file lazily, through an 'error' event on the returned stream, exactly like
   * Vendure's own `LocalAssetStorageStrategy`.
   */
  public readFileToStream(identifier: string, encoding?: BufferEncoding | null): Promise<Stream> {
    return this.run('readFileToStream', identifier, true, async (disk, key) => {
      const stream = await disk.getStream(key)
      const readable = stream instanceof Stream ? stream : new Readable().wrap(stream)
      if (encoding && typeof (readable as Readable).setEncoding === 'function') {
        ;(readable as Readable).setEncoding(encoding)
      }
      return readable
    })
  }

  /** Idempotent: deleting a file that is already gone is not an error. */
  public deleteFile(identifier: string): Promise<void> {
    return this.run('deleteFile', identifier, false, async (disk, key) => {
      try {
        await disk.delete(key)
      } catch (error) {
        if (!isFileNotFound(error)) {
          throw error
        }
      }
    })
  }

  /**
   * Provider errors are propagated instead of being reported as "missing": Vendure uses this
   * method to pick a free file name, and a silent `false` could overwrite an existing asset.
   */
  public fileExists(fileName: string): Promise<boolean> {
    return this.run('fileExists', fileName, false, async (disk, key) => {
      const { exists } = await disk.exists(key)
      return exists === true
    })
  }

  private requireDisk(): AbstractStorage {
    if (!this.disk) {
      throw new FactorydriveAssetConfigurationError(
        'FactorydriveAssetStorageStrategy is not initialised: Vendure calls init(injector) during bootstrap. ' +
          'Register it through AssetServerPlugin.init({ storageStrategyFactory }) or FactorydriveAssetPlugin.init().',
      )
    }
    return this.disk
  }

  /**
   * Runs a disk operation with a validated key, logs failures with their context (disk,
   * operation, key) and rethrows the original error so callers can still inspect it.
   * Synchronous throws from drivers (e.g. MethodNotSupportedException) are handled too.
   */
  private async run<T>(operation: Operation, rawKey: unknown, isRead: boolean, fn: (disk: AbstractStorage, key: string) => Promise<T>): Promise<T> {
    let key: string | undefined
    try {
      const disk = this.requireDisk()
      key = normalizeAssetKey(rawKey)
      return await fn(disk, key)
    } catch (error) {
      this.logFailure(operation, key ?? rawKey, error, isRead)
      throw error
    }
  }

  private logFailure(operation: Operation, key: unknown, error: unknown, isRead: boolean): void {
    const message = `${operation} failed on Factorydrive disk ${this.diskLabel} for key ${describeKey(key)}: ${safeErrorSummary(error)}`
    if (isRead && isExpectedReadMiss(error)) {
      // Cache misses and 404s are part of the AssetServerPlugin's normal flow.
      Logger.debug(message, loggerCtx)
      return
    }
    Logger.error(message, loggerCtx, error instanceof Error ? error.stack : undefined)
  }

  private async removePartialWrite(disk: AbstractStorage, key: string): Promise<void> {
    try {
      await disk.delete(key)
    } catch (cleanupError) {
      if (!isFileNotFound(cleanupError)) {
        Logger.warn(`Could not remove partially written key ${describeKey(key)} from Factorydrive disk ${this.diskLabel}: ${safeErrorSummary(cleanupError)}`, loggerCtx)
      }
    }
  }
}
