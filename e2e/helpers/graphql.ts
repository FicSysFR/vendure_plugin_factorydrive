// Copyright 2026 FicSys
// SPDX-License-Identifier: Apache-2.0

import gql from 'graphql-tag'

export const CREATE_ASSETS = gql`
  mutation CreateAssets($input: [CreateAssetInput!]!) {
    createAssets(input: $input) {
      ... on Asset {
        id
        name
        source
        preview
        mimeType
        fileSize
      }
      ... on MimeTypeError {
        errorCode
        message
      }
    }
  }
`

export const DELETE_ASSET = gql`
  mutation DeleteAsset($input: DeleteAssetInput!) {
    deleteAsset(input: $input) {
      result
      message
    }
  }
`

export interface CreatedAsset {
  id: string
  name: string
  source: string
  preview: string
  mimeType: string
  fileSize: number
}
