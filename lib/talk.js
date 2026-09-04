'use strict';

/* What a talk is, said once.
 *
 * Its words, its type, its images, its look and its templates.
 * Everything else — the parser, the renderer, the server, the frame's own
 * stylesheet and the deck's runtime — is shared and lives outside it.
 *
 *   my-talk/
 *     deck.md
 *     fonts/           the .woff2 files and their licences, vendored
 *     deck.css         its typefaces, its colours, and the vocabulary
 *                      its templates share
 *     images/          the figures and the icons, named from the deck
 *                      without a path; `icon-` marks the small ones
 *     templates/       one .html per template, and optionally a .js for
 *                      values to work out and a .css for its own rules
 *
 * Each folder is mounted at the URL of its own name, so a `src` the markup
 * writes resolves against the talk folder unchanged. The shared checks
 * rely on that: it is what lets them test a URL by looking on disk.
 *
 * This returns exactly the shape `render(src, opts)` takes, so a caller
 * that has a talk folder never has to know how its parts are laid out.
 */

const path = require('path');

function talk(dir) {
  const root = path.resolve(dir);
  return {
    dir: root,
    deck: path.join(root, 'deck.md'),
    fontRoot: path.join(root, 'fonts'),
    imageRoot: path.join(root, 'images'),
    deckCss: path.join(root, 'deck.css'),
    templateRoot: path.join(root, 'templates'),
    /* Not paths: the URL prefixes the deck's own markup writes, the same
       for every talk because the server mounts each folder at the URL of
       its name. */
    imagePath: 'images',
  };
}

module.exports = { talk };
