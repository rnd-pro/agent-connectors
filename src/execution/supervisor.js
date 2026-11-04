import { fork, spawn } from 'node:child_process';
import { EXECUTION_LIMITS } from './constants.js';

// This process never imports connector code. Its event loop stays available to
// clean up a blocked connector when the calling process is forcibly terminated.
let worker = fork(new URL('./child.js', import.meta.url), [], {
  execPath: process.execPath,
  execArgv: [
    '--max-old-space-size=128',
  ],
  env: process.env,
  stdio: [
    'pipe',
    'pipe',
    'pipe',
    'ipc',
  ],
});

worker.stdout?.pipe(process.stdout);
worker.stderr?.pipe(process.stderr);
worker.stdin?.on('error', () => {});
worker.on('error', () => process.exit(1));
worker.on('message', (message) => {
  if (process.connected) { process.send?.(message, () => {}); }
});
process.on('message', (message) => {
  if (worker.connected) { worker.send(/** @type {import('node:child_process').Serializable} */ (message), () => {}); }
});
/** @type {ReturnType<typeof setTimeout> | undefined} */
let deadline;
worker.on('close', () => { clearTimeout(deadline); process.exit(0); });
function stopTree() {
  if (process.platform !== 'win32') {
    try { process.kill(-process.pid, 'SIGKILL'); } catch { process.exit(1); }
  } else {
    let killer = spawn('taskkill.exe', [
      '/PID',
      String(process.pid),
      '/T',
      '/F',
    ], {
      shell: false,
      stdio: 'ignore',
    });
    killer.on('error', () => { worker.kill('SIGKILL'); process.exit(1); });
  }
}
process.on('disconnect', stopTree);

try {
  let chunks = [];
  let size = 0;
  for await (let chunk of process.stdin) {
    size += chunk.length;
    if (size > EXECUTION_LIMITS.inputBytes + EXECUTION_LIMITS.credentialsBytes + 8192) { throw new Error('Envelope limit.'); }
    chunks.push(chunk);
  }
  let bytes = Buffer.concat(chunks);
  let envelope = JSON.parse(bytes.toString('utf8'));
  if (!Number.isInteger(envelope.timeoutMs) || envelope.timeoutMs < 1 || envelope.timeoutMs > 300000) { throw new Error('Invalid deadline.'); }
  // Independent watchdog still runs if the caller is stopped or crashes.
  deadline = setTimeout(stopTree, envelope.timeoutMs + EXECUTION_LIMITS.killGraceMs);
  worker.stdin?.end(bytes);
} catch { stopTree(); }
