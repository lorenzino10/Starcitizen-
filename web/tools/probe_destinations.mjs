// Sonda temporanea (2): valori ambientali e POI di starmap.space.
const UA = { 'User-Agent': 'NAVCOM-personal/0.8 (+https://github.com/lorenzino10/Starcitizen-)', Accept: 'application/json' };
async function get(url) { const r = await fetch(url, { headers: UA }); const t = await r.text(); try { return [r.status, JSON.parse(t)]; } catch { return [r.status, t.slice(0, 200)]; } }
const SM = 'https://starmap.space/api/v4/';
for (const s of ['Stanton', 'Pyro', 'Nyx']) {
  const [st, j] = await get(SM + 'oc/index.php?system=' + s);
  console.log('### oc', s, st);
  for (const o of Array.isArray(j) ? j : []) if (o.Gravitation != null || o.SurfaceMinTemp != null || o.AtmosphereBreathable != null || ['Planet', 'Moon'].includes(o.Type))
    console.log('OC', JSON.stringify({ n: o.ObjectContainer, t: o.Type, min: o.SurfaceMinTemp, max: o.SurfaceMaxTemp, br: o.AtmosphereBreathable, comp: o.AtmosphericComposition, ah: o.AtmosphereHeight, g: o.Gravitation, hab: o.Habitable, bio: o.Biomes, cls: o.Classification, oc: o.Oceans, jur: o.Jurisdiction, aff: o.Affiliation, lz: o.LandingZones, c: o.Comment, sub: o.Submitted }));
}
for (const q of ['pois/index.php?planet=Daymar', 'pois/index.php?planet=daymar', 'pois/index.php?itemid=1', 'pois/index.php?planet=%25', 'pois/index.php?planet=Pyro%25', 'pois/index.php?planet=Bloom']) {
  const [st, j] = await get(SM + q);
  console.log('### pois', q, st, Array.isArray(j) ? `n=${j.length}` : JSON.stringify(j).slice(0, 200));
  if (Array.isArray(j) && j.length) { console.log('KEYS', Object.keys(j[0]).join(',')); console.log('P1', JSON.stringify(j[0]).slice(0, 2500)); const a = j.find((x) => x.Zone_Armistice === '1' || x.POI_Services); if (a) console.log('P2', JSON.stringify(a).slice(0, 2500)); }
}
