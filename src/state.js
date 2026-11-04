import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export function defaultStateRoot() {
  return resolve(process.env.AGENT_CONNECTORS_HOME || join(homedir(), '.agent-connectors'));
}
