import { Ajv2020 } from 'ajv/dist/2020.js';
import manifestSchema from '../schemas/connector.schema.json' with { type: 'json' };
import registrySchema from '../schemas/registry.schema.json' with { type: 'json' };
import connectionSchema from '../schemas/connections.schema.json' with { type: 'json' };
import { ensure } from './errors.js';
import { SCHEMA_DIALECT } from './constants.js';

function validator() {
  return new Ajv2020({
    strict: true,
    allErrors: true,
    validateFormats: false,
  });
}

let ajv = validator();
let manifest = ajv.compile(manifestSchema);
let registry = ajv.compile(registrySchema);
let connections = ajv.compile(connectionSchema);

/**
 * @param {import('ajv').ValidateFunction} validate
 * @param {unknown} value
 */
function assertSchema(validate, value) {
  ensure(validate(value), 'INVALID_DOCUMENT', ajv.errorsText(validate.errors));
}

/**
 * @param {boolean | Record<string, unknown>} schema
 */
function checkContract(schema) {
  ensure(typeof schema === 'boolean' || !('$schema' in schema) || schema.$schema === SCHEMA_DIALECT,
    'INVALID_SCHEMA', 'Only JSON Schema 2020-12 is supported.');
  try { validator().compile(schema); }
  catch (error) { ensure(false, 'INVALID_SCHEMA', error instanceof Error ? error.message : 'Invalid JSON Schema.'); }
}

/**
 * @param {unknown} value
 * @returns {import('../types/contracts.js').Manifest}
 */
export function validateManifest(value) {
  assertSchema(manifest, value);
  let result = /** @type {import('../types/contracts.js').Manifest} */ (value);
  checkContract(result.inputSchema);
  checkContract(result.outputSchema);
  return result;
}

/**
 * @param {unknown} value
 * @returns {import('../types/contracts.js').RegistryDocument}
 */
export function validateRegistry(value) {
  assertSchema(registry, value);
  let result = /** @type {import('../types/contracts.js').RegistryDocument} */ (value);
  let ids = new Set(result.scripts.map((script) => script.id));
  ensure(ids.size === result.scripts.length, 'INVALID_DOCUMENT', 'Duplicate script identity.');
  ensure(new Set(result.scripts.map((script) => script.path.toLowerCase())).size === ids.size,
    'INVALID_DOCUMENT', 'Duplicate or case-colliding script location.');
  ensure(new Set(result.bindings.map((binding) => binding.address)).size === result.bindings.length,
    'INVALID_DOCUMENT', 'Duplicate semantic address.');
  for (let binding of result.bindings) {
    ensure(result.scripts.some((script) => script.id === binding.scriptId && script.revisions.includes(binding.revision)),
      'INVALID_DOCUMENT', 'A binding must reference a registered script revision directly.');
  }
  return result;
}

/**
 * @param {unknown} value
 * @returns {import('../types/contracts.js').ConnectionDocument}
 */
export function validateConnections(value) {
  assertSchema(connections, value);
  return /** @type {import('../types/contracts.js').ConnectionDocument} */ (value);
}
