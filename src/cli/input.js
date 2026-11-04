import { ensure } from '../errors.js';
import { readBytes, utf8 } from '../files.js';

/**
 * @param {string | undefined} file
 * @param {number} limit
 */
export async function readJsonInput(file, limit) {
  let bytes;
  if (file !== undefined) { bytes = await readBytes(file, limit); }
  else {
    ensure(!process.stdin.isTTY, 'INVALID_INPUT', 'Supply a JSON file or JSON on stdin.');
    let chunks = [];
    let size = 0;
    for await (let chunk of process.stdin) {
      size += chunk.length;
      ensure(size <= limit, 'INVALID_INPUT', 'JSON input exceeds the size limit.');
      chunks.push(chunk);
    }
    bytes = Buffer.concat(chunks);
  }
  try { return JSON.parse(utf8(bytes)); }
  catch { ensure(false, 'INVALID_INPUT', 'Input must be UTF-8 JSON.'); }
}
