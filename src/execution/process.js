import { fork, spawn } from 'node:child_process';
import { EXECUTION_LIMITS } from './constants.js';

/**
 * @param {import('../../types/contracts.js').ChildEnvelope} envelope
 * @param {{ timeoutMs: number; signal: AbortSignal; checkAccess: () => Promise<boolean> }} options
 * @returns {Promise<import('../../types/contracts.js').ExecutionResult>}
 */
export function executeProcess(envelope, options) {
  return new Promise((resolve) => {
    /** @type {NodeJS.ProcessEnv} */
    let env = {};
    for (let name of [
      'SYSTEMROOT',
      'WINDIR',
      'TEMP',
      'TMP',
      'LANG',
      'LC_ALL',
    ]) {
      if (process.env[name]) { env[name] = process.env[name]; }
    }
    let child = fork(new URL('./supervisor.js', import.meta.url), [], {
      execPath: process.execPath,
      execArgv: [
        '--max-old-space-size=128',
      ],
      cwd: envelope.snapshot,
      env,
      detached: process.platform !== 'win32',
      stdio: [
        'pipe',
        'pipe',
        'pipe',
        'ipc',
      ],
      serialization: 'json',
    });
    let spawned = false;
    let starting = false;
    let finished = false;
    let stopping = false;
    /** @type {Buffer[]} */
    let logChunks = [];
    let logBytes = 0;
    /** @type {import('../../types/contracts.js').ExecutionResult | undefined} */
    let result;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let killTimer;

    /** @param {NodeJS.Signals} signal */
    function kill(signal) {
      if (!child.pid) { return; }
      if (process.platform === 'win32') {
        let killer = spawn('taskkill.exe', [
          '/PID',
          String(child.pid),
          '/T',
          '/F',
        ], {
          shell: false,
          stdio: 'ignore',
        });
        killer.on('error', () => child.kill(signal));
      } else {
        try { process.kill(-child.pid, signal); } catch { /* Owned group may already be gone. */ }
      }
    }

    function finish() {
      if (finished) { return; }
      finished = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      options.signal.removeEventListener('abort', abort);
      child.stdin?.destroy();
      child.stdout?.destroy();
      child.stderr?.destroy();
      kill('SIGKILL');
      let output = result ?? {
        state: spawned ? 'unknown' : 'rejected',
        code: 'PROCESS_FAILED',
      };
      let logs = Buffer.concat(logChunks).toString('utf8');
      for (let secret of Object.values(envelope.credentials)) { logs = logs.split(secret).join('[REDACTED]'); }
      logs = Buffer.from(logs).subarray(0, EXECUTION_LIMITS.outputBytes).toString('utf8');
      resolve({
        ...output,
        ...(logs ? {
          logs,
        } : {}),
      });
    }

    /** @param {string} code */
    function stop(code) {
      if (stopping || finished) { return; }
      stopping = true;
      result = {
        state: 'unknown',
        code,
      };
      child.send({
        type: 'cancel',
      }, () => {});
      kill('SIGTERM');
      killTimer = setTimeout(() => { kill('SIGKILL'); finish(); }, EXECUTION_LIMITS.killGraceMs);
    }

    function abort() { stop('CANCELLED'); }
    let timer = setTimeout(() => stop('TIMEOUT'), options.timeoutMs);
    options.signal.addEventListener('abort', abort, {
      once: true,
    });
    child.on('spawn', () => { spawned = true; });
    child.on('error', () => { if (spawned) { stop('PROCESS_FAILED'); } else { finish(); } });
    child.on('close', finish);
    child.stdin?.on('error', () => stop('PROCESS_FAILED'));
    /** @param {Buffer} bytes */
    function log(bytes) {
      logBytes += bytes.length;
      if (logBytes > EXECUTION_LIMITS.outputBytes) { stop('OUTPUT_LIMIT'); }
      else { logChunks.push(bytes); }
    }
    child.stdout?.on('data', log);
    child.stderr?.on('data', log);
    child.on('message', (message) => {
      if (!message || typeof message !== 'object' || !('type' in message) || finished || stopping) { return; }
      if (message.type === 'ready' && !starting) {
        starting = true;
        void options.checkAccess().then((allowed) => {
          if (!allowed) { stop('ACCESS_REVOKED'); }
          else if (!finished && !stopping) {
            child.send({
              type: 'start',
            }, () => {});
          }
        }).catch(() => stop('ACCESS_REVOKED'));
      }
      if (message.type === 'result' && 'result' in message) {
        let candidate = /** @type {import('../../types/contracts.js').ExecutionResult} */ (message.result);
        if (!candidate || !new Set([
          'completed',
          'rejected',
          'unknown',
        ]).has(candidate.state) || Buffer.byteLength(JSON.stringify(candidate)) > envelope.resultBytes + 1024) { stop('RESULT_LIMIT'); return; }
        result = {
          state: candidate.state,
          ...(candidate.code ? {
            code: candidate.code,
          } : {}),
          ...(candidate.state === 'completed' ? {
            value: candidate.value,
          } : {}),
        };
        stopping = true;
        kill('SIGTERM');
        killTimer = setTimeout(() => { kill('SIGKILL'); finish(); }, EXECUTION_LIMITS.killGraceMs);
      }
    });
    if (options.signal.aborted) { abort(); }
    else { child.stdin?.end(JSON.stringify(envelope)); }
  });
}
