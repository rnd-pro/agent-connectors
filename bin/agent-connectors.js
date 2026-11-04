#!/usr/bin/env node
import { main } from '../src/cli/run.js';

await main(process.argv.slice(2));
