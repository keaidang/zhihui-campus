import fs from 'node:fs';
fs.writeFileSync(new URL('./canary.txt', import.meta.url), 'node ok ' + new Date().toISOString());
try {
  const m = await import('mysql2/promise');
  fs.appendFileSync(new URL('./canary.txt', import.meta.url), '\nmysql2 ok');
} catch (e) {
  fs.appendFileSync(new URL('./canary.txt', import.meta.url), '\nmysql2 FAIL: ' + e.message);
}
try {
  const b = await import('bcryptjs');
  fs.appendFileSync(new URL('./canary.txt', import.meta.url), '\nbcryptjs ok');
} catch (e) {
  fs.appendFileSync(new URL('./canary.txt', import.meta.url), '\nbcryptjs FAIL: ' + e.message);
}
try {
  const d = await import('./lib/db.js');
  fs.appendFileSync(new URL('./canary.txt', import.meta.url), '\ndb.js ok');
} catch (e) {
  fs.appendFileSync(new URL('./canary.txt', import.meta.url), '\ndb.js FAIL: ' + e.message);
}
