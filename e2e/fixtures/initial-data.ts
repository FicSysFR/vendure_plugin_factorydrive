// Copyright 2026 FicSys
// SPDX-License-Identifier: Apache-2.0

import { type InitialData, LanguageCode } from '@vendure/core'

/** Smallest dataset Vendure's test server accepts: assets do not depend on catalog data. */
export const initialData: InitialData = {
  defaultLanguage: LanguageCode.en,
  defaultZone: 'Europe',
  taxRates: [{ name: 'Standard Tax', percentage: 20 }],
  shippingMethods: [{ name: 'Standard Shipping', price: 500 }],
  paymentMethods: [],
  countries: [{ name: 'France', code: 'FR', zone: 'Europe' }],
  collections: [],
}
