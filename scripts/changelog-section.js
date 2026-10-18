'use strict';
/*
 * Prints one version's section of CHANGELOG.md (without its "## x.y.z" heading),
 * for the GitHub release notes. Exits with an error if the version has no section,
 * so a release can't go out without its changelog.
 *
 *   node scripts/changelog-section.js 1.3.0
 */
const fs = require('fs');
const path = require('path');

function section(text, version) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const esc = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const head = new RegExp(`^##\\s+v?${esc}(\\s|$)`);
  const start = lines.findIndex(l => head.test(l));
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  if (end < 0) end = lines.length;
  const body = lines.slice(start + 1, end).join('\n').trim();
  return body || null;
}

if (require.main === module) {
  const version = String(process.argv[2] || '').replace(/^v/, '');
  const text = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
  const out = version && section(text, version);
  if (!out) { console.error(`CHANGELOG.md has no section for ${version || '(no version given)'}`); process.exit(1); }
  process.stdout.write(out + '\n');
}

module.exports = { section };
