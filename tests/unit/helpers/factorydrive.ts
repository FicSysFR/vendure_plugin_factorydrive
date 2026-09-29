// Copyright 2026 FicSys
// SPDX-License-Identifier: Apache-2.0

import { type AbstractStorage, FactorydriveService, type StorageManagerConfig } from '@ficsysfr/nestjs_module_factorydrive'
import type { Injector } from '@vendure/core'
import { FactorydriveAssetStorageStrategy } from '../../../src/factorydrive-asset-storage-strategy'
import type { FactorydriveAssetStorageOptions } from '../../../src/types'
import { MemoryStorage } from './memory-storage'

type DriverConstructor = new (...args: never[]) => AbstractStorage

/**
 * Builds a real FactorydriveService (as FactorydriveModule would), registers the given drivers
 * and runs its onModuleInit hook.
 */
export async function createFactorydrive(config: StorageManagerConfig, drivers: Record<string, DriverConstructor> = { memory: MemoryStorage }): Promise<FactorydriveService> {
  const service = new FactorydriveService(config)
  for (const [name, driver] of Object.entries(drivers)) {
    service.registerDriver(name, driver as new (...args: unknown[]) => AbstractStorage)
  }
  await service.onModuleInit()
  return service
}

/** Minimal stand-in for Vendure's Injector (which delegates to ModuleRef.get with strict: false). */
export function injectorFor(service: FactorydriveService | undefined): Injector {
  return {
    get: (token: unknown) => {
      if (token === FactorydriveService && service) {
        return service
      }
      throw new Error(`Nest could not find ${String((token as { name?: string })?.name ?? token)} element`)
    },
  } as unknown as Injector
}

export const assetsAndDocuments: StorageManagerConfig = {
  default: 'assets',
  disks: {
    assets: { driver: 'memory', config: {} },
    documents: { driver: 'memory', config: {} },
  },
}

export async function createStrategy(options: FactorydriveAssetStorageOptions = { disk: 'assets' }, config: StorageManagerConfig = assetsAndDocuments) {
  const factorydrive = await createFactorydrive(config)
  const strategy = new FactorydriveAssetStorageStrategy(options)
  await strategy.init(injectorFor(factorydrive))
  const disk = (name?: string) => factorydrive.getDisk<MemoryStorage>(name)
  return { factorydrive, strategy, disk }
}
