// Copyright 2026 FicSys
// SPDX-License-Identifier: Apache-2.0

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'

/**
 * Deterministic PNG fixtures generated at test time (no binary files checked in).
 */

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(typeAndData))
  return Buffer.concat([length, typeAndData, checksum])
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** RGB PNG filled with seeded noise: noise does not compress, which keeps the file size predictable. */
export function createNoisePng(width: number, height: number, seed = 1): Buffer {
  const random = mulberry32(seed)
  const rowLength = width * 3 + 1
  const raw = Buffer.alloc(rowLength * height)
  for (let y = 0; y < height; y++) {
    raw[y * rowLength] = 0 // filter type: none
    for (let x = 1; x < rowLength; x++) {
      raw[y * rowLength + x] = Math.floor(random() * 256)
    }
  }

  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 2 // colour type: RGB
  header[10] = 0 // compression
  header[11] = 0 // filter
  header[12] = 0 // interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

/** Reads width/height from a PNG IHDR chunk. */
export function pngSize(png: Buffer): { width: number; height: number } {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
}

export interface ImageFixtures {
  /** ~190 KB: larger than Vendure's 4100-byte sniffing window, uploaded through writeFileFromStream. */
  large: string
  /** < 1 KB: on Vendure >= 3.6.5 small uploads go through writeFileFromBuffer. */
  small: string
}

export async function writeImageFixtures(directory: string): Promise<ImageFixtures> {
  const large = join(directory, 'large-noise.png')
  const small = join(directory, 'small-noise.png')
  await writeFile(large, createNoisePng(256, 256, 42))
  await writeFile(small, createNoisePng(16, 16, 7))
  return { large, small }
}
