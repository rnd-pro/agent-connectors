export const CONTRACT_VERSION = 1;
export const SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema';
export const ADDRESS_PATTERN = '^[a-z][a-z0-9_-]*(\\.[a-z][a-z0-9_-]*)*$';
export const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
export const REVISION_PATTERN = '^sha256:[0-9a-f]{64}$';
export const LIMITS = Object.freeze({
  registryBytes: 4 * 1024 * 1024,
  fileBytes: 1024 * 1024,
  descriptionBytes: 64 * 1024,
  bundleBytes: 16 * 1024 * 1024,
  bundleFiles: 512,
  pageSize: 100,
});
