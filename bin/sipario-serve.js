#!/usr/bin/env node
'use strict';

/* `sipario serve`, under the name talks already have in their scripts. */

require('../lib/cli.js').run('serve', process.argv.slice(2), 'sipario-serve');
