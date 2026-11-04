export const EXECUTION_LIMITS = Object.freeze({
  inputBytes: 65536,
  credentialsBytes: 65536,
  outputBytes: 16384,
  resultBytes: 1048576,
  authorityBytes: 1048576,
  receipts: 128,
  concurrency: 4,
  killGraceMs: 250,
  pollMs: 100,
});
