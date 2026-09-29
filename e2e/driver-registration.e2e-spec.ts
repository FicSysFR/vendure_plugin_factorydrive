// Copyright 2026 FicSys
// SPDX-License-Identifier: Apache-2.0

import { mkdirSync, mkdtempSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FactorydriveModule, FactorydriveService, LocalFileSystemStorage, type Response as StorageResponse } from '@ficsysfr/nestjs_module_factorydrive'
import { mergeConfig, PluginCommonModule, VendurePlugin } from '@vendure/core'
import { createTestEnvironment, testConfig } from '@vendure/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FactorydriveAssetPlugin } from '../src'
import { writeImageFixtures } from './fixtures/images'
import { initialData } from './fixtures/initial-data'
import { listKeys, registerSqljs } from './helpers/environment'
import { CREATE_ASSETS, type CreatedAsset } from './helpers/graphql'
import { pathOf, rawGet } from './helpers/http'

registerSqljs()

const PORT = 3052

/** Stands for any third-party driver (S3, SFTP, custom...) that must be registered by name. */
class CustomDriverStorage extends LocalFileSystemStorage {
  public static readonly written: string[] = []

  public override async put(location: string, content: Buffer | NodeJS.ReadableStream | string): Promise<StorageResponse> {
    CustomDriverStorage.written.push(location)
    return super.put(location, content)
  }
}

/**
 * The pattern documented for Factorydrive 2.0 (no declarative `drivers` option): register the
 * driver from a provider factory. Nest instantiates every provider before running any
 * onModuleInit hook, so the driver is known when FactorydriveService builds its disks.
 */
@VendurePlugin({
  imports: [PluginCommonModule],
  providers: [
    {
      provide: 'FACTORYDRIVE_DRIVERS_REGISTERED',
      inject: [FactorydriveService],
      useFactory: (factorydrive: FactorydriveService) => {
        factorydrive.registerDriver('custom', CustomDriverStorage)
        return true
      },
    },
  ],
  compatibility: '^3.0.0',
})
class FactorydriveDriversPlugin {}

const workDir = mkdtempSync(join(tmpdir(), 'vendure-factorydrive-drivers-'))
const assetsRoot = join(workDir, 'storage')
mkdirSync(assetsRoot, { recursive: true })

describe('Factorydrive driver registered by a Vendure plugin', () => {
  const { server, adminClient } = createTestEnvironment(
    mergeConfig(testConfig, {
      apiOptions: { port: PORT },
      plugins: [
        FactorydriveModule.forRoot({ default: 'assets', disks: { assets: { driver: 'custom', config: { root: assetsRoot } } } }),
        FactorydriveDriversPlugin,
        // No disk option: the Factorydrive default disk is used.
        FactorydriveAssetPlugin.init({ assetServer: { assetUploadDir: join(workDir, 'asset-server') } }),
      ],
    }),
  )
  let fixture: string

  beforeAll(async () => {
    await mkdir(join(workDir, 'fixtures'), { recursive: true })
    fixture = (await writeImageFixtures(join(workDir, 'fixtures'))).large
    await server.init({ initialData, customerCount: 0 })
    await adminClient.asSuperAdmin()
  })

  afterAll(async () => {
    await server.destroy()
    await rm(workDir, { recursive: true, force: true })
  })

  it('stores and serves assets through the custom driver on the default disk', async () => {
    const { createAssets } = await adminClient.fileUploadMutation({
      mutation: CREATE_ASSETS,
      filePaths: [fixture],
      mapVariables: (paths: string[]) => ({ input: paths.map(() => ({ file: null })) }),
    })
    const [asset] = createAssets as CreatedAsset[]

    const sourceKey = new URL(asset.source).pathname.replace(/^\/assets\//, '')
    expect(CustomDriverStorage.written).toEqual(expect.arrayContaining([sourceKey]))
    expect(await listKeys(assetsRoot)).toContain(sourceKey)
    expect((await rawGet(PORT, pathOf(asset.source))).status).toBe(200)
  })
})
