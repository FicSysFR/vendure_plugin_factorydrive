// Copyright 2026 FicSys
// SPDX-License-Identifier: Apache-2.0

import { type IncomingHttpHeaders, request } from 'node:http'

export interface RawResponse {
  status: number
  headers: IncomingHttpHeaders
  body: Buffer
}

/**
 * GET with the path sent exactly as given. `fetch` normalises `..` and `%2e%2e` segments
 * client-side, which would hide path traversal payloads from the server.
 */
export function rawGet(port: number, rawPath: string): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method: 'GET', path: rawPath }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.end()
  })
}

/** Path + query of an absolute asset URL returned by the GraphQL API. */
export function pathOf(url: string): string {
  const parsed = new URL(url)
  return `${parsed.pathname}${parsed.search}`
}
