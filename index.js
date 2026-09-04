'use strict';

/* sipario: a markdown deck, rendered.
 *
 * Everything a talk needs and nothing a talk owns. The format, the
 * renderer and its checks, the deck's runtime, the presenter window, the
 * frame's stylesheet and a server that renders per request. No templates
 * and no design: what a slide of a given template looks like is the
 * talk's decision, and every talk carries its own `templates/` folder.
 */

const { render, parse, identity, grouped, toolkit,
        MissingTalkOption } = require('./lib/render.js');
const { talk } = require('./lib/talk.js');
const { load } = require('./lib/templates.js');
const { compile } = require('./lib/engine.js');
const { serve } = require('./lib/server.js');
const { deckPage, presenterPage, errorPage } = require('./lib/pages.js');
const { talkChecks } = require('./lib/lint.js');
const { scaffold } = require('./lib/scaffold.js');

/* Where the shared half lives on disk, for a suite that has to read it. */
const paths = {
  root: __dirname,
  css: `${__dirname}/css`,
  js: `${__dirname}/js`,
};

module.exports = {
  render, parse, identity, grouped, toolkit, MissingTalkOption,
  talk, load, compile, serve,
  deckPage, presenterPage, errorPage,
  talkChecks, scaffold, paths,
};
