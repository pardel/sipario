#!/usr/bin/env node
'use strict';

/* `sipario renumber`, under the name talks already have in their scripts. */

require('../lib/cli.js').run('renumber', process.argv.slice(2), 'sipario-renumber');
