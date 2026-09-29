// Copyright 2026 FicSys
// SPDX-License-Identifier: Apache-2.0

import { mkdirSync, mkdtempSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { FactorydriveModule, LocalFileSystemStorage } from '@ficsysfr/nestjs_module_factorydrive'
import { mergeConfig } from '@vendure/core'
import { createTestEnvironment, testConfig } from '@vendure/testing'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { FactorydriveAssetPlugin } from '../src'
import { type ImageFixtures, pngSize, writeImageFixtures } from './fixtures/images'
import { initialData } from './fixtures/initial-data'
import { listKeys, registerSqljs, vendureAtLeast } from './helpers/environment'
import { CREATE_ASSETS, type CreatedAsset, DELETE_ASSET } from './helpers/graphql'
import { pathOf, rawGet } from './helpers/http'

registerSqljs()

const PORT = 3051

const workDir = mkdtempSync(join(tmpdir(), 'vendure-factorydrive-e2e-'))
const assetsRoot = join(workDir, 'storage', 'assets')
const documentsRoot = join(workDir, 'storage', 'documents')
mkdirSync(assetsRoot, { recursive: true })
mkdirSync(documentsRoot, { recursive: true })

describe('Vendure assets stored on a Factorydrive local disk', () => {
  let fixtures: ImageFixtures
  const putSpy = vi.spyOn(LocalFileSystemStorage.prototype, 'put')

  const { server, adminClient } = createTestEnvironment(
    mergeConfig(testConfig, {
      apiOptions: { port: PORT },
      plugins: [
        // The default disk is deliberately NOT the assets disk: Vendure must only touch the disk it is given.
        FactorydriveModule.forRoot({
          default: 'documents',
          disks: {
            assets: { driver: 'local', config: { root: assetsRoot } },
            documents: { driver: 'local', config: { root: documentsRoot } },
          },
        }),
        FactorydriveAssetPlugin.init({
          disk: 'assets',
          assetServer: {
            route: 'assets',
            assetUploadDir: join(workDir, 'asset-server'),
            presets: [{ name: 'product-card', width: 600, height: 750, mode: 'crop' }],
          },
        }),
      ],
    }),
  )

  async function upload(filePaths: string[]): Promise<CreatedAsset[]> {
    const { createAssets } = await adminClient.fileUploadMutation({
      mutation: CREATE_ASSETS,
      filePaths,
      mapVariables: (paths: string[]) => ({ input: paths.map(() => ({ file: null })) }),
    })
    for (const asset of createAssets) {
      expect(asset).not.toHaveProperty('errorCode')
    }
    return createAssets
  }

  /** Storage key of an asset URL: `http://localhost:3051/assets/source/ab/x.png` -> `source/ab/x.png`. */
  function keyOf(url: string): string {
    return decodeURIComponent(new URL(url).pathname.replace(/^\/assets\//, ''))
  }

  beforeAll(async () => {
    const fixturesDir = join(workDir, 'fixtures')
    await mkdir(fixturesDir, { recursive: true })
    fixtures = await writeImageFixtures(fixturesDir)
    await server.init({ initialData, customerCount: 0 })
    await adminClient.asSuperAdmin()
  })

  afterAll(async () => {
    await server.destroy()
    putSpy.mockRestore()
    await rm(workDir, { recursive: true, force: true })
  })

  let large: CreatedAsset
  let small: CreatedAsset

  it('stores uploaded sources and previews on the Factorydrive disk with portable keys', async () => {
    putSpy.mockClear()
    ;[large, small] = await upload([fixtures.large, fixtures.small])

    for (const asset of [large, small]) {
      expect(asset.source).toMatch(new RegExp(`^http://localhost:${PORT}/assets/source/[0-9a-f]{2}/`))
      expect(asset.preview).toMatch(new RegExp(`^http://localhost:${PORT}/assets/preview/[0-9a-f]{2}/`))
      expect(asset.source).not.toContain('\\')
    }

    const keys = await listKeys(assetsRoot)
    expect(keys).toEqual(expect.arrayContaining([keyOf(large.source), keyOf(large.preview), keyOf(small.source), keyOf(small.preview)]))
    await expect(readFile(join(assetsRoot, keyOf(large.source)))).resolves.toEqual(await readFile(fixtures.large))
  })

  it('streams large uploads into Factorydrive instead of buffering them', () => {
    const largeWrite = putSpy.mock.calls.find(([location]) => location.replace(/\\/g, '/').endsWith(keyOf(large.source)))
    expect(largeWrite).toBeDefined()
    // Checked after the upload completed: the stream has been consumed, so assert its type
    // (Factorydrive's isReadableStream() also requires it to still be readable).
    expect(largeWrite?.[1]).toBeInstanceOf(Readable)
    expect(Buffer.isBuffer(largeWrite?.[1])).toBe(false)

    const smallWrite = putSpy.mock.calls.find(([location]) => location.replace(/\\/g, '/').endsWith(keyOf(small.source)))
    expect(smallWrite).toBeDefined()
    // Vendure >= 3.6.5 sniffs the first 4100 bytes and writes small files from a Buffer.
    expect(Buffer.isBuffer(smallWrite?.[1])).toBe(vendureAtLeast('3.6.5'))
  })

  it('serves the original and the preview through the AssetServerPlugin route', async () => {
    const source = await rawGet(PORT, pathOf(large.source))
    expect(source.status).toBe(200)
    expect(source.headers['content-type']).toMatch(/^image\/png/)
    expect(source.body).toEqual(await readFile(join(assetsRoot, keyOf(large.source))))

    const preview = await rawGet(PORT, pathOf(large.preview))
    expect(preview.status).toBe(200)
    expect(preview.body).toEqual(await readFile(join(assetsRoot, keyOf(large.preview))))
  })

  it('applies presets and stores the transformed image in the Factorydrive cache', async () => {
    const before = await listKeys(assetsRoot)

    const response = await rawGet(PORT, `${pathOf(large.preview)}?preset=product-card`)

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toMatch(/^image\/png/)
    expect(pngSize(response.body)).toEqual({ width: 600, height: 750 })
    const created = (await listKeys(assetsRoot)).filter((key) => !before.includes(key))
    expect(created).toHaveLength(1)
    expect(created[0]).toMatch(/^cache\/preview\/[0-9a-f]{2}\//)
    await expect(readFile(join(assetsRoot, created[0]))).resolves.toEqual(response.body)
  })

  it('serves repeated transformations from the cache without writing again', async () => {
    const url = `${pathOf(large.preview)}?w=120&h=80&mode=crop`
    const first = await rawGet(PORT, url)
    expect(first.status).toBe(200)
    expect(pngSize(first.body)).toEqual({ width: 120, height: 80 })

    putSpy.mockClear()
    const second = await rawGet(PORT, url)

    expect(second.status).toBe(200)
    expect(second.body).toEqual(first.body)
    expect(putSpy).not.toHaveBeenCalled()
  })

  it.each([
    ['resize mode', '?w=100&h=100&mode=resize', /^image\/png/],
    ['WebP output', '?w=64&h=64&format=webp', /^image\/webp/],
    ['AVIF output', '?w=32&h=32&format=avif', /^image\/avif/],
    ['JPEG quality', '?w=64&h=64&format=jpg&q=40', /^image\/jpeg/],
    ['focal point crop', '?w=100&h=40&fpx=0.2&fpy=0.8', /^image\/png/],
  ])('supports %s', async (_label, query, contentType) => {
    const before = await listKeys(assetsRoot)

    const response = await rawGet(PORT, `${pathOf(large.source)}${query}`)

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toMatch(contentType)
    expect(response.body.length).toBeGreaterThan(0)
    const created = (await listKeys(assetsRoot)).filter((key) => !before.includes(key))
    expect(created).toHaveLength(1)
    expect(created[0]).toMatch(/^cache\/source\//)
  })

  it('does not store anything when the cache is disabled for a request', async () => {
    const before = await listKeys(assetsRoot)

    const response = await rawGet(PORT, `${pathOf(large.source)}?w=33&h=33&cache=false`)

    expect(response.status).toBe(200)
    expect(await listKeys(assetsRoot)).toEqual(before)
  })

  it('never serves files outside the disk root', async () => {
    const secret = `sentinel-${Date.now()}`
    const sentinel = join(dirname(assetsRoot), `${secret}.txt`)
    await writeFile(sentinel, secret)
    const name = basename(sentinel)

    for (const path of [
      `/assets/../${name}`,
      `/assets/..%2f${name}`,
      `/assets/..%5c${name}`,
      `/assets/%2e%2e%2f${name}`,
      `/assets/%2e%2e/${name}`,
      `/assets/source/..%2f..%2f${name}`,
    ]) {
      const response = await rawGet(PORT, path)
      expect(response.status, path).not.toBe(200)
      expect(response.body.toString('utf8'), path).not.toContain(secret)
    }
  })

  it('answers 404 for missing files and directories', async () => {
    expect((await rawGet(PORT, '/assets/source/zz/missing.png')).status).toBe(404)
    expect((await rawGet(PORT, '/assets/source')).status).toBe(404)
  })

  it('resolves name conflicts through fileExists()', async () => {
    const [duplicate] = await upload([fixtures.large])

    expect(keyOf(duplicate.source)).not.toBe(keyOf(large.source))
    expect(keyOf(duplicate.source)).toMatch(/__02\.png$/)
  })

  it('never touches the other Factorydrive disks', async () => {
    expect(await listKeys(documentsRoot)).toEqual([])
  })

  it('deletes the source and preview files when the asset is deleted', async () => {
    const { deleteAsset } = await adminClient.query(DELETE_ASSET, { input: { assetId: small.id, force: true } })
    expect(deleteAsset.result).toBe('DELETED')

    const keys = await listKeys(assetsRoot)
    expect(keys).not.toContain(keyOf(small.source))
    expect(keys).not.toContain(keyOf(small.preview))
    expect((await rawGet(PORT, pathOf(small.source))).status).toBe(404)
  })

  it('keeps serving stored assets after a restart', async () => {
    await server.destroy()
    await server.bootstrap()

    const response = await rawGet(PORT, pathOf(large.source))
    expect(response.status).toBe(200)
    expect(response.body).toEqual(await readFile(fixtures.large))
  })
})
