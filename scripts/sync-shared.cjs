'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
for (const file of ['domain.js', 'memory-store.js']) {
  fs.copyFileSync(path.join(root, 'cloudfunctions/readingClub', file), path.join(root, 'miniprogram/shared', file));
}
console.log('Shared business rules synced.');

fs.mkdirSync(path.join(root, "miniprogram/v2/shared"), { recursive: true });
for (const file of ["domain.js", "memory-store.js"]) fs.copyFileSync(path.join(root, file === "domain.js" ? "cloudfunctions/readingClubV2" : "cloudfunctions/readingClub", file), path.join(root, "miniprogram/v2/shared", file));
