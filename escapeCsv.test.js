const assert = require('assert');

function escapeCsv(val) {
  if (val == null) return "";
  const s = String(val);
  if(/[",\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// Tests for commas and quotes
assert.strictEqual(escapeCsv('value,with,commas'), '"value,with,commas"');
assert.strictEqual(escapeCsv('He said "hi"'), '"He said ""hi"""');
console.log('escapeCsv tests passed.');
