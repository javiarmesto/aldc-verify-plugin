'use strict';
// Entry point so `node --test tests/` works on every Node version:
// - Node 20 searches the folder and runs the *.test.js files itself (this file is not a test name).
// - Node 22+ treats `tests/` as a path, resolves it to this index.js and runs it: load every test file.

const fs = require('fs');
const path = require('path');

if (require.main === module) {
  for (const f of fs.readdirSync(__dirname).filter((n) => n.endsWith('.test.js')).sort()) {
    require(path.join(__dirname, f));
  }
}
