// Copyright 2026 FicSys
// SPDX-License-Identifier: Apache-2.0

import { mkdirSync, mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FactorydriveModule, FactorydriveService } from '@ficsysfr/nestjs_module_factorydrive'
import { type AmazonWebServicesS3StorageConfig, AwsS3Storage } from '@ficsysfr/nestjs_module_factorydrive-s3'
import { mergeConfig, PluginCommonModule, VendurePlugin } from '@vendure/core'
import { createTestEnvironment, testConfig } from '@vendure/testing'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FactorydriveAssetPlugin } from '../../src'
import { type ImageFixtures, writeImageFixtures } from '../fixtures/images'
import { initialData } from '../fixtures/initial-data'
import { registerSqljs } from '../helpers/environment'
import { CREATE_ASSETS, type CreatedAsset, DELETE_ASSET } from '../helpers/graphql'
import { pathOf, rawGet } from '../helpers/http'

/**
 * Vendure -> Factorydrive -> S3 driver -> S3-compatible storage.
 *
 * Opt-in (FACTORYDRIVE_E2E_S3=1). By default a RustFS container is started with Testcontainers
 * (Docker required). To target an existing S3-compatible service instead (MinIO, Garage,
 * LocalStack...), set FACTORYDRIVE_E2E_S3_ENDPOINT, FACTORYDRIVE_E2E_S3_ACCESS_KEY and
 * FACTORYDRIVE_E2E_S3_SECRET_KEY. Nothing in the plugin is specific to RustFS: it is simply an
 * S3-compatible endpoint used with path-style addressing.
 */
const enabled = process.env.FACTORYDRIVE_E2E_S3 === '1'
const image = process.env.FACTORYDRIVE_E2E_S3_IMAGE ?? 'rustfs/rustfs:1.0.0'
const bucket = `vendure-assets-${Date.now()}`
const PORT = 3053

registerSqljs()

const workDir = mkdtempSync(join(tmpdir(), 'vendure-factorydrive-s3-'))
mkdirSync(join(workDir, 'fixtures'), { recursive: true })

/** Filled in beforeAll, read lazily by the disk config factory when the server bootstraps. */
const s3: { config?: AmazonWebServicesS3StorageConfig } = {}

@VendurePlugin({
  imports: [PluginCommonModule],
  providers: [
    {
      provide: 'FACTORYDRIVE_S3_DRIVER_REGISTERED',
      inject: [FactorydriveService],
      useFactory: (factorydrive: FactorydriveService) => {
        factorydrive.registerDriver('s3', AwsS3Storage)
        return true
      },
    },
  ],
  compatibility: '^3.0.0',
})
class S3DriverPlugin {}

describe.skipIf(!enabled)('Vendure assets on an S3-compatible Factorydrive disk', () => {
  let container: StartedTestContainer | undefined
  let fixtures: ImageFixtures
  let disk: AwsS3Storage

  const { server, adminClient } = createTestEnvironment(
    mergeConfig(testConfig, {
      apiOptions: { port: PORT },
      plugins: [
        FactorydriveModule.forRootAsync({
          useFactory: () => {
            if (!s3.config) {
              throw new Error('S3 endpoint not ready')
            }
            return { default: 'assets', disks: { assets: { driver: 's3', config: s3.config } } }
          },
        }),
        S3DriverPlugin,
        FactorydriveAssetPlugin.init({
          disk: 'assets',
          assetServer: {
            assetUploadDir: join(workDir, 'asset-server'),
            presets: [{ name: 'product-card', width: 600, height: 750, mode: 'crop' }],
          },
        }),
      ],
    }),
  )

  async function objectExists(key: string): Promise<boolean> {
    return (await disk.exists(key)).exists
  }

  function keyOf(url: string): string {
    return decodeURIComponent(new URL(url).pathname.replace(/^\/assets\//, ''))
  }

  beforeAll(async () => {
    let endpoint = process.env.FACTORYDRIVE_E2E_S3_ENDPOINT
    let accessKeyId = process.env.FACTORYDRIVE_E2E_S3_ACCESS_KEY ?? 'rustfsadmin'
    let secretAccessKey = process.env.FACTORYDRIVE_E2E_S3_SECRET_KEY ?? 'rustfsadmin'

    if (!endpoint) {
      accessKeyId = 'factorydrive-e2e'
      secretAccessKey = 'factorydrive-e2e-secret'
      container = await new GenericContainer(image)
        .withEnvironment({ RUSTFS_ACCESS_KEY: accessKeyId, RUSTFS_SECRET_KEY: secretAccessKey, RUSTFS_VOLUMES: '/data' })
        .withExposedPorts(9000)
        .withWaitStrategy(Wait.forHttp('/health', 9000))
        .start()
      endpoint = `http://${container.getHost()}:${container.getMappedPort(9000)}`
    }

    s3.config = { bucket, endpoint, region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId, secretAccessKey } }
    disk = new AwsS3Storage(s3.config)
    await disk.driver().createBucket({ Bucket: bucket })

    fixtures = await writeImageFixtures(join(workDir, 'fixtures'))
    await server.init({ initialData, customerCount: 0 })
    await adminClient.asSuperAdmin()
  }, 300_000)

  afterAll(async () => {
    await server.destroy()
    await container?.stop()
    await rm(workDir, { recursive: true, force: true })
  })

  let large: CreatedAsset
  let small: CreatedAsset

  it('uploads through the S3 driver (streamed large file, buffered small file)', async () => {
    const { createAssets } = await adminClient.fileUploadMutation({
      mutation: CREATE_ASSETS,
      filePaths: [fixtures.large, fixtures.small],
      mapVariables: (paths: string[]) => ({ input: paths.map(() => ({ file: null })) }),
    })
    ;[large, small] = createAssets as CreatedAsset[]

    for (const asset of [large, small]) {
      expect(asset).not.toHaveProperty('errorCode')
      await expect(objectExists(keyOf(asset.source))).resolves.toBe(true)
      await expect(objectExists(keyOf(asset.preview))).resolves.toBe(true)
    }
  })

  it('serves assets and stores transformations in the bucket', async () => {
    const source = await rawGet(PORT, pathOf(large.source))
    expect(source.status).toBe(200)
    expect(source.body.equals((await disk.getBuffer(keyOf(large.source))).content)).toBe(true)

    const transformed = await rawGet(PORT, `${pathOf(large.preview)}?preset=product-card`)
    expect(transformed.status).toBe(200)
    const cacheKeys: string[] = []
    for await (const entry of disk.flatList('cache/')) {
      cacheKeys.push(entry.path)
    }
    expect(cacheKeys.length).toBeGreaterThan(0)
  })

  it('answers 404 for missing objects', async () => {
    expect((await rawGet(PORT, '/assets/source/zz/missing.png')).status).toBe(404)
  })

  it('deletes objects when the asset is deleted', async () => {
    const { deleteAsset } = await adminClient.query(DELETE_ASSET, { input: { assetId: small.id, force: true } })
    expect(deleteAsset.result).toBe('DELETED')

    await expect(objectExists(keyOf(small.source))).resolves.toBe(false)
    await expect(objectExists(keyOf(small.preview))).resolves.toBe(false)
  })
})
