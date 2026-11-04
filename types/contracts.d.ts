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

export type InvocationSource = 'cli' | 'agent' | 'agui';

export interface Grant {
  id: string;
  registryId: string;
  registryRoot: string;
  scope: string;
  scriptId: string;
  revision: string;
  effect: 'read' | 'write';
  source: InvocationSource;
  profile: string | null;
  profileRevision: string | null;
  timeoutMs: number;
  resultBytes: number;
  revoked: boolean;
}

export interface CredentialProfile {
  name: string;
  revision: string;
  values: Record<string, string>;
}

export interface Authority {
  formatVersion: 1;
  grants: Grant[];
  profiles: CredentialProfile[];
}

export interface Receipt {
  requestId: string;
  fingerprint: string;
  inputDigest: string;
  registryId: string;
  scope: string;
  source: InvocationSource;
  scriptId: string;
  revision: string;
  grantId: string;
  state: 'running' | 'completed' | 'rejected' | 'unknown';
  createdAt: number;
  deadline: number;
  ownerPid: number;
  token: string;
  code?: string;
}

export interface ReceiptIndex {
  formatVersion: 1;
  entries: Receipt[];
}

export interface ExecutionResult {
  state: 'completed' | 'rejected' | 'unknown';
  code?: string;
  value?: unknown;
  logs?: string;
}

export type ReceiptView = Receipt & Partial<Omit<ExecutionResult, 'state'>>;

export interface ExecutionRequest {
  scope: string;
  requestId: string;
  source?: InvocationSource;
  signal?: AbortSignal;
}

export interface GrantOptions {
  scope: string;
  revision: string;
  effect: 'read' | 'write';
  source: InvocationSource;
  profile?: string;
  timeoutMs?: number;
  resultBytes?: number;
}

export interface ChildEnvelope {
  snapshot: string;
  revision: string;
  input: unknown;
  credentials: Record<string, string>;
  requestId: string;
  scope: string;
  source: InvocationSource;
  effect: 'read' | 'write';
  resultBytes: number;
  timeoutMs: number;
}
