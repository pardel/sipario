#!/usr/bin/env node
'use strict';

/* `sipario <command>`. The commands are in lib/cli.js; this is argv. */

const { run, commands, HELP } = require('../lib/cli.js');

const [name, ...args] = process.argv.slice(2);

if (!name || name === 'help' || name === '--help' || name === '-h') {
  console.log(HELP);
  process.exit(name ? 0 : 2);
}

if (!Object.prototype.hasOwnProperty.call(commands, name)) {
  console.error(`sipario: no command "${name}"\n\n${HELP}`);
  process.exit(2);
}

run(name, args, `sipario ${name}`);
