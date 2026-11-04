import { parseArgs } from 'node:util';
import { COMMANDS, HELP } from './commands.js';
import { defaultStateRoot, findRegistry, changeConnection, readConnections } from '../connections.js';
import { FileRegistry } from '../registry/registry.js';
import { initializeRegistry } from '../registry/store.js';
import { ConnectorError, ensure } from '../errors.js';
import { json, readBytes, utf8 } from '../files.js';
import { LIMITS } from '../constants.js';

/**
 * @param {string[]} args
 */
export async function run(args) {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      options: {
        help: {
          type: 'boolean',
          short: 'h',
        },
        version: {
          type: 'boolean',
        },
        ...Object.fromEntries([
          'registry',
          'name',
          'file',
          'path',
          'project',
          'effect',
          'script',
          'revision',
          'from',
          'expected-generation',
          'offset',
          'limit',
        ].map((name) => [
          name,
          {
            type: 'string',
          },
        ])),
      },
    });
  } catch (error) { throw new ConnectorError('INVALID_INPUT', error instanceof Error ? error.message : 'Invalid arguments.'); }
  if (parsed.values.help || !args.length) { return HELP; }
  if (parsed.values.version) {
    let {
      default: pkg,
    } = await import('../../package.json', {
      with: {
        type: 'json',
      },
    });
    return {
      version: pkg.version,
      contractVersion: 1,
    };
  }
  let positionals = parsed.positionals;
  let command = positionals.shift() || '';
  if (command === 'registry') { command += ` ${positionals.shift() || ''}`; }
  ensure(Object.hasOwn(COMMANDS, command), 'INVALID_INPUT', `Unknown command: ${command}. Use --help.`);
  let definition = COMMANDS[/** @type {keyof typeof COMMANDS} */ (command)];
  ensure(definition.args === -1 ? positionals.length <= 1 : positionals.length === definition.args,
    'INVALID_INPUT', `Usage: ${definition.usage}`);
  let values = /** @type {Record<string, string | boolean | undefined>} */ (parsed.values);
  for (let name of Object.keys(values)) {
    ensure(name === 'registry' || /** @type {readonly string[]} */ (definition.options).includes(name),
      'INVALID_INPUT', `Option --${name} is not supported by ${command}.`);
  }
  /** @param {string} name */
  function required(name) {
    let value = values[name];
    ensure(typeof value === 'string' && value.length, 'INVALID_INPUT', `Missing --${name}.`);
    return value;
  }
  /** @param {string} name */
  function optional(name) {
    let value = values[name];
    return typeof value === 'string' ? value : undefined;
  }
  /** @param {string} name */
  function integer(name) {
    let value = optional(name);
    ensure(value === undefined || /^(0|[1-9][0-9]*)$/.test(value), 'INVALID_INPUT', `--${name} must be a nonnegative integer.`);
    let number = value === undefined ? undefined : Number(value);
    ensure(number === undefined || Number.isSafeInteger(number), 'INVALID_INPUT', `--${name} is out of range.`);
    return number;
  }
  let stateRoot = defaultStateRoot();
  let target = positionals[0] || '';
  let registryHandlers = {
    'registry init': () => initializeRegistry(target),
    'registry list': () => readConnections(stateRoot),
    'registry connect': () => changeConnection(stateRoot, required('name'), target),
    'registry disconnect': () => changeConnection(stateRoot, target, null),
  };
  if (Object.hasOwn(registryHandlers, command)) {
    return registryHandlers[/** @type {keyof typeof registryHandlers} */ (command)]();
  }
  let root = await findRegistry(optional('registry'), stateRoot);
  let registry = await FileRegistry.open(root, stateRoot);
  let generation = integer('expected-generation');
  let page = {
    offset: integer('offset'),
    limit: integer('limit'),
  };
  let handlers = {
    list: () => registry.list(target, page),
    search: () => registry.search(target, page),
    show: () => registry.show(target),
    describe: async () => registry.describe(target, optional('file') === undefined ? undefined
      : utf8(await readBytes(required('file'), LIMITS.descriptionBytes)), generation),
    source: () => registry.source(target, optional('path')),
    create: () => registry.create(target, required('project'), /** @type {'read' | 'write'} */ (optional('effect') ?? 'read'), generation),
    bind: () => registry.bind(target, required('script'), required('revision'), generation),
    unbind: () => registry.unbind(target, generation),
    check: () => registry.check(target),
    prepare: () => registry.prepare(target, generation),
    diff: () => registry.diff(target, required('from')),
  };
  return handlers[/** @type {keyof typeof handlers} */ (command)]();
}

/** @param {string[]} args */
export async function main(args) {
  try {
    let result = await run(args);
    process.stdout.write(typeof result === 'string' ? `${result}\n` : json({
      ok: true,
      result,
    }));
  } catch (error) {
    let code = error instanceof ConnectorError ? error.code : 'IO_ERROR';
    process.stderr.write(json({
      ok: false,
      error: {
        code,
        message: error instanceof Error ? error.message : 'Operation failed.',
      },
    }));
    process.exitCode = code === 'INVALID_INPUT' ? 2 : 1;
  }
}
