import { gzipSync } from 'node:zlib';
const UA = { 'User-Agent': 'NAVCOM-probe (github.com/lorenzino10/Starcitizen-)', Accept: 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dump = (label, obj) => { const b = gzipSync(Buffer.from(JSON.stringify(obj))).toString('base64'); const n = 60000; const parts = Math.ceil(b.length / n); for (let i = 0; i < parts; i++) console.log(`@@${label}@@${i}/${parts}@@${b.slice(i * n, (i + 1) * n)}`); };
const W = 'https://api.star-citizen.wiki/api/missions';
async function j(url) { for (let i = 0; i < 4; i++) { try { const r = await fetch(url, { headers: UA }); if (r.status === 429 || r.status >= 500) throw new Error('HTTP ' + r.status); return { status: r.status, body: await r.json() }; } catch (e) { await sleep(1000 * 2 ** i); } } return { status: 0 }; }
const f = await j(`${W}/filters`); dump('filters', f.body);
const list = []; let page = 1, last = 1;
do { const r = await j(`${W}?filter[grouped]=false&page[size]=100&page[number]=${page}`); list.push(...r.body.data); last = r.body.meta.last_page; page++; await sleep(150); } while (page <= last);
const H = list.filter((m) => m.has_hauling && m.released && !m.not_for_release && !m.work_in_progress);
console.log('hauling released', H.length);
const det = []; let fail = 0;
for (const m of H) { const r = await j(`${W}/${m.uuid}`); if (r.status === 200) det.push(r.body.data); else fail++; await sleep(120); }
console.log('details', det.length, 'fail', fail);
dump('details', det);
// prova filtri documentati
for (const q of ['filter[star_system]=Pyro', 'filter[system]=Pyro', 'filter[has_hauling]=true', 'filter[version]=4.9.0-LIVE.12232306', 'version=4.9.0-LIVE.12232306', 'filter[game_version]=4.9.0-LIVE.12232306', 'include=variants']) { const r = await j(`${W}?page[size]=1&${q}`); console.log('Q', q, r.status, r.body?.meta?.total, r.body?.data?.[0]?.version); await sleep(200); }
