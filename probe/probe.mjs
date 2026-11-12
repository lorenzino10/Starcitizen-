import { gzipSync } from 'node:zlib';
const UA = { 'User-Agent': 'NAVCOM-probe (github.com/lorenzino10/Starcitizen-)', Accept: 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) { const r = await fetch(url, { headers: UA }); const t = await r.text(); return { status: r.status, type: r.headers.get('content-type'), text: t }; }
const dump = (label, obj) => { const b = gzipSync(Buffer.from(JSON.stringify(obj))).toString('base64'); const n = 60000; const parts = Math.ceil(b.length / n); for (let i = 0; i < parts; i++) console.log(`@@${label}@@${i}/${parts}@@${b.slice(i * n, (i + 1) * n)}`); };
const W = 'https://api.star-citizen.wiki';
const out = {};
for (const p of ['/api/game-versions', '/api/game-versions/default', '/api/missions/filters', '/api/missions?page[size]=3', '/api/missions?filter[grouped]=true&page[size]=3', '/api/missions?filter[grouped]=false&page[size]=3', '/api-docs.json', '/docs/api-docs.json']) {
  const r = await get(W + p); out[p] = { status: r.status, type: r.type, body: r.text.slice(0, 20000) }; console.log(p, r.status, r.type, r.text.length); await sleep(300);
}
for (const p of ['https://docs.star-citizen.wiki/api-docs.json', 'https://docs.star-citizen.wiki/docs/api-docs.json', 'https://docs.star-citizen.wiki/openapi.json', 'https://docs.star-citizen.wiki/']) { const r = await get(p); out[p] = { status: r.status, type: r.type, body: r.text.slice(0, 400000) }; console.log(p, r.status, r.type, r.text.length); }
for (const p of ['https://versefiles.com/', 'https://versefiles.com/robots.txt', 'https://versefiles.com/api', 'https://verse-base.com/missionen.html', 'https://verse-base.com/robots.txt', 'https://sc-toolbox.com/', 'https://sc-toolbox.com/robots.txt', 'https://sc-toolbox.com/api']) { try { const r = await get(p); out[p] = { status: r.status, type: r.type, body: r.text.slice(0, 30000) }; console.log(p, r.status, r.type, r.text.length); } catch (e) { out[p] = { error: e.message }; console.log(p, 'ERR', e.message); } }
dump('meta', out);
// lista completa
for (const grouped of ['false', 'true']) {
  const list = []; let page = 1, last = 1, meta = null;
  do { const r = await get(`${W}/api/missions?filter[grouped]=${grouped}&page[size]=100&page[number]=${page}`); const j = JSON.parse(r.text); list.push(...(j.data ?? [])); meta = j.meta; last = j.meta?.last_page ?? page; page++; await sleep(200); } while (page <= last && page < 300);
  console.log(`grouped=${grouped}: ${list.length} total meta=${JSON.stringify(meta)?.slice(0, 300)}`);
  dump(`list-${grouped}`, list);
}
