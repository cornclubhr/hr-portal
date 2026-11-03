/**
 * Where the code under test lives.
 *
 * The tests used to hardcode an absolute path into one particular machine,
 * which meant the harness shipped in the repository could not run anywhere
 * except where it was written. That is the opposite of the point: these checks
 * exist so the person deploying can prove the code is sound on their own
 * machine before pushing it.
 *
 * Two layouts are supported, resolved from this file's own location:
 *
 *   the repository          <repo>/tools/*.js      <repo>/gas      <repo>/*.js
 *   the working copy        <wc>/tools/*.js        <wc>/naeem-hr/gas
 *                                                  <wc>/naeem-hr/web
 *
 * A directory is only accepted if a file that must be there actually is, so a
 * wrong guess fails loudly here instead of producing empty, passing tests.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const HERE = __dirname;

function pick(label, marker, candidates) {
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, marker))) return dir;
  }
  throw new Error(
    'Cannot locate the ' + label + ' directory (looked for "' + marker + '" in):\n  ' +
    candidates.join('\n  ') +
    '\nRun the tests from the repository, or pass the right layout.');
}

const GAS = pick('gas', 'Code.js', [
  path.join(HERE, '..', 'gas'),
  path.join(HERE, '..', 'naeem-hr', 'gas')
]);

const WEB = pick('web', 'session.js', [
  path.join(HERE, '..'),
  path.join(HERE, '..', 'naeem-hr', 'web')
]);

module.exports = { GAS: GAS, WEB: WEB };
