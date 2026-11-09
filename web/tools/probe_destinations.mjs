// Sonda temporanea: stampa nel log la forma delle fonti (status, conteggio, campi, 2 esempi).
const UA = { 'User-Agent': 'NAVCOM-personal/0.8 (+https://github.com/lorenzino10/Starcitizen-)', Accept: 'application/json' };
const show = (o, n = 1600) => JSON.stringify(o).slice(0, n);
async function probe(label, url, pick = (j) => j) {
  try {
    const r = await fetch(url, { headers: UA });
    const t = await r.text();
    let j; try { j = JSON.parse(t); } catch { console.log(`### ${label} ${r.status} non-JSON ${t.slice(0, 300)}`); return; }
    const d = pick(j);
    const arr = Array.isArray(d) ? d : Array.isArray(d?.data) ? d.data : Array.isArray(d?.items) ? d.items : null;
    console.log(`### ${label} ${r.status} ${arr ? `n=${arr.length}` : 'obj'} hdr=${r.headers.get('x-data-source') ?? ''}`);
    if (arr) {
      const keys = new Set(); arr.forEach((x) => Object.keys(x ?? {}).forEach((k) => keys.add(k)));
      console.log('KEYS', [...keys].join(','));
      console.log('S1', show(arr[0])); console.log('S2', show(arr[Math.floor(arr.length / 2)]));
    } else console.log('OBJ', show(j, 2500));
  } catch (e) { console.log(`### ${label} ERR ${e.message}`); }
}
const U = 'https://api.uexcorp.uk/2.0/';
for (const e of ['star_systems', 'planets', 'moons', 'space_stations', 'cities', 'outposts', 'poi', 'terminals', 'jurisdictions', 'categories', 'fuel_prices_all', 'commodities_prices_all', 'items_prices_all', 'commodities', 'refineries_yields']) await probe(`uex ${e}`, U + e);
await probe('uex items cat1', U + 'items?id_category=1');
const SM = 'https://starmap.space/api/v4/';
await probe('sm oc Stanton', SM + 'oc/index.php?system=Stanton');
await probe('sm oc Pyro', SM + 'oc/index.php?system=Pyro');
await probe('sm oc Nyx', SM + 'oc/index.php?system=Nyx');
await probe('sm pois microTech', SM + 'pois/index.php?planet=microTech');
await probe('sm pois all', SM + 'pois/index.php');
const C = 'https://citizenhq.space/api/v1/';
for (const e of ['health', 'item-shops', 'stations', 'trade/terminals-list', 'fuel-prices', 'items?q=helix']) await probe(`chq ${e}`, C + e);
