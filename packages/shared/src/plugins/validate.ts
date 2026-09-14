// Cursor manifest schemas: Copyright (c) 2026 Cursor, MIT. See LICENSE.cursor.
import { Ajv } from 'ajv'
import addFormats from 'ajv-formats'
import manifestSchema from './plugin.schema.json' with { type: 'json' }
import marketplaceSchema from './marketplace.schema.json' with { type: 'json' }
import type { PluginManifest, PluginMarketplace, VariableSchema } from './types.js'

const ajv = new Ajv({ allErrors: true, strict: false })
addFormats(ajv)
const manifestValidator = ajv.compile<PluginManifest>(manifestSchema)
const marketplaceValidator = ajv.compile<PluginMarketplace>(marketplaceSchema)

export function validateManifest(value: unknown): PluginManifest {
  if (!manifestValidator(value)) throw new Error(`Invalid plugin manifest: ${ajv.errorsText(manifestValidator.errors)}`)
  return value
}
export function validateMarketplace(value: unknown): PluginMarketplace {
  if (!marketplaceValidator(value)) throw new Error(`Invalid marketplace: ${ajv.errorsText(marketplaceValidator.errors)}`)
  return value
}
export function validateVariables(schema: VariableSchema | undefined, value: unknown): void {
  if (schema && !ajv.validate(schema, value)) throw new Error(`Invalid plugin variables: ${ajv.errorsText()}`)
}
