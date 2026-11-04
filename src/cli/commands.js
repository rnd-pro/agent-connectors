import { EXECUTION_COMMANDS } from './execution.js';

export const COMMANDS = Object.freeze({
  ...EXECUTION_COMMANDS,
  'registry init': {
    args: 1,
    options: [],
    usage: 'registry init <folder>',
  },
  'registry connect': {
    args: 1,
    options: [
      'name',
    ],
    usage: 'registry connect <folder> --name <name>',
  },
  'registry list': {
    args: 0,
    options: [],
    usage: 'registry list',
  },
  'registry disconnect': {
    args: 1,
    options: [],
    usage: 'registry disconnect <name>',
  },
  list: {
    args: -1,
    options: [
      'offset',
      'limit',
    ],
    usage: 'list [namespace] [--offset N] [--limit N]',
  },
  search: {
    args: 1,
    options: [
      'offset',
      'limit',
    ],
    usage: 'search <query> [--offset N] [--limit N]',
  },
  show: {
    args: 1,
    options: [],
    usage: 'show <address>',
  },
  describe: {
    args: 1,
    options: [
      'file',
      'expected-generation',
    ],
    usage: 'describe <address> [--file <markdown>]',
  },
  source: {
    args: 1,
    options: [
      'path',
    ],
    usage: 'source <address> [--path <bundle-file>]',
  },
  create: {
    args: 1,
    options: [
      'project',
      'effect',
      'expected-generation',
    ],
    usage: 'create <address> --project <folder> [--effect read|write]',
  },
  bind: {
    args: 1,
    options: [
      'script',
      'revision',
      'expected-generation',
    ],
    usage: 'bind <address> --script <UUID> --revision <sha256:digest>',
  },
  unbind: {
    args: 1,
    options: [
      'expected-generation',
    ],
    usage: 'unbind <address>',
  },
  check: {
    args: 1,
    options: [],
    usage: 'check <address>',
  },
  prepare: {
    args: 1,
    options: [
      'expected-generation',
    ],
    usage: 'prepare <address>',
  },
  diff: {
    args: 1,
    options: [
      'from',
    ],
    usage: 'diff <address> --from <sha256:digest>',
  },
});

export const HELP = [
  'Usage: agent-connectors <command> [--registry <name|./folder>]',
  '',
  ...Object.values(COMMANDS).map((command) => `  ${command.usage}`),
  '',
  'Mutation commands accept --expected-generation N for optimistic concurrency.',
  'Default scope is the nearest ancestor registry.json. Explicit selection never falls back.',
  'AGENT_CONNECTORS_HOME sets private connections and prepared snapshot storage.',
  'create prepares and binds an unimplemented scaffold; prepare never moves existing aliases.',
  'describe --file edits working documentation; prepare and bind publish a new revision explicitly.',
  'All output is formatted JSON. Only run executes connector source, after an exact private grant.',
  'Writes must return context.verified(value) after verifying the domain result, or context.unknown().',
  'Request IDs retain results or unknown outcomes; retries never automatically rerun retained requests.',
  'Remote registries and AGUI integration are not available in this release.',
].join('\n');
