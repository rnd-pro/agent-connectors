export interface Manifest {
  contractVersion: 1;
  id: string;
  name: string;
  tags: string[];
  entry: 'index.js';
  effect: 'read' | 'write';
  inputSchema: boolean | Record<string, unknown>;
  outputSchema: boolean | Record<string, unknown>;
  credentials: string[];
  access: {
    network: string[];
    files: string[];
  };
  limits: {
    timeoutMs: number;
    resultBytes: number;
  };
}

export interface ScriptRecord {
  id: string;
  path: string;
  revisions: string[];
}

export interface Binding {
  address: string;
  scriptId: string;
  revision: string;
}

export interface RegistryDocument {
  formatVersion: 1;
  id: string;
  generation: number;
  scripts: ScriptRecord[];
  bindings: Binding[];
}

export interface BundleFile {
  path: string;
  size: number;
  sha256: string;
}

export interface Bundle {
  revision: string;
  manifest: Manifest;
  description: string;
  files: BundleFile[];
  contents: Map<string, Buffer>;
}

export interface RegistrySource {
  root: string;
  registryId: string;
}

export interface ConnectionDocument {
  formatVersion: 1;
  generation: number;
  sources: Record<string, RegistrySource>;
}

export interface PageOptions {
  offset?: number;
  limit?: number;
}
