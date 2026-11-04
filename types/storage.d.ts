import type { RegistryDocument } from './contracts.js';

export interface RegistrySnapshot {
  document: RegistryDocument;
  text: string;
  digest: string;
}

export interface RegistryStorage {
  read(): Promise<RegistrySnapshot>;
  compareAndSet(before: RegistrySnapshot, document: RegistryDocument): Promise<void>;
}

export type StorageTarget =
  | { type: 'file' }
  | { type: 'sqlite'; database: string }
  | { type: 'postgres'; profile: string };

export type StorageConnection = StorageTarget & { version: 1; registryId: string; root: string };
export interface StorageMarker { version: 1; type: StorageTarget['type']; registryId: string }
