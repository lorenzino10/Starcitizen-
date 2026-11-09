// DESTINATION INTELLIGENCE: costruzione dello snapshot statico dalle fonti grezze.
// Funzioni pure (nessuna rete): le usa web/tools/fetch_destinations.mjs in GitHub Actions e i test
// con dati sintetici. Regole:
//  - ogni valore porta la sua fonte; un campo assente resta null (mai riempito per "fare scena");
//  - nessun servizio passa da un luogo a un altro (citta' -> avamposto, stazione -> punto XYZ);
//  - l'abbinamento fra fonti usa gli uuid della starmap quando ci sono, il nome solo se UNIVOCO
//    nello stesso sistema; i casi ambigui restano scollegati con l'elenco dei candidati.
import { normName } from '../logistics/model.js';

export const SRC = {
  scu: { id: 'scu', label: 'scunpacked-data (file di gioco)', url: 'https://github.com/StarCitizenWiki/scunpacked-data', kind: 'documentata', license: 'nessun file LICENSE nel repository' },
  uex: { id: 'uex', label: 'UEX Corp API 2.0 (segnalazioni della community)', url: 'https://uexcorp.space/api/documentation/', kind: 'segnalata', license: 'uso personale non commerciale; dati crowdsourced, possono non riflettere i server live' },
  sm: { id: 'sm', label: 'StarMap / Eureka (starmap.space API v4)', url: 'https://starmap.space/api/docs.php', kind: 'documentata', license: 'API gratuita in sola lettura, nessuna licenza formale; immagini non usate' },
};

const PLACEHOLDER = /^<=.*=>$/;
const clean = (s) => (s == null || PLACEHOLDER.test(String(s).trim()) || !String(s).trim() ? null : String(s).trim());
const sysKey = (s) => (s ? normName(s).replace(/ system$/, '') : null);
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

// ------------------------------------------------------------------ file di gioco (scunpacked)

/** Servizi della starmap del gioco ("Amenities") -> chiavi NAVCOM. Nessuna equivalenza fra servizi diversi. */
export const AMENITY = {
  'Hangar S': { k: 'hangar', size: 'S' }, 'Hangar M': { k: 'hangar', size: 'M' }, 'Hangar L': { k: 'hangar', size: 'L' }, 'Hangar XL': { k: 'hangar', size: 'XL' },
  'Landing Pad XS': { k: 'pad', size: 'XS' }, 'Landing Pad S': { k: 'pad', size: 'S' }, 'Landing Pad M': { k: 'pad', size: 'M' }, 'Landing Pad L': { k: 'pad', size: 'L' }, 'Landing Pad XL': { k: 'pad', size: 'XL' },
  Docking: { k: 'docking' },
  'Vehicle Services': { k: 'vehicleServices' },
  'Commodity Trading - Freight Elevator': { k: 'freightElevator' },
  'Commodity Trading - Loading Dock': { k: 'loadingDock' },
  Refinery: { k: 'refinery' }, Clinic: { k: 'clinic' }, Hospital: { k: 'hospital' },
  'Food Court': { k: 'food' }, Garage: { k: 'garage' },
  'Buy Armor': { k: 'shopArmor' }, 'Buy Weapons': { k: 'shopWeapons' }, 'Buy Clothing': { k: 'shopClothing' },
  'Buy Ship Items and Weapons': { k: 'shopShipItems' }, 'Rent Vehicles': { k: 'rentVehicles' }, 'Buy Vehicles': { k: 'buyVehicles' }, 'Buy and Rent Vehicles': { k: 'buyRentVehicles' },
};

/**
 * starmap.json del gioco -> informazioni per uuid: servizi, giurisdizione, tipo di respawn, descrizione.
 * @returns {Object<string, object>}
 */
export function buildGameInfo(starmap) {
  const out = {};
  for (const e of starmap ?? []) {
    if (!e?.UUID) continue;
    const amen = (e.Amenities ?? []).map((a) => clean(a?.Name)).filter(Boolean);
    const j = e.Jurisdiction;
    out[e.UUID] = {
      name: clean(e.Name),
      type: e.Type?.Name ?? null,
      navIcon: e.NavIcon ?? null,
      description: clean(e.Description),
      amenities: amen,
      unknownAmenities: amen.filter((a) => !AMENITY[a]),
      jurisdiction: j ? { name: clean(j.Name), baseFine: j.BaseFine ?? null, maxStolenScu: j.MaxStolenGoodsPossessionScu ?? null, isPrison: !!j.IsPrison } : null,
      affiliation: clean(e.Affiliation?.Name ?? (typeof e.Affiliation === 'string' ? e.Affiliation : null)),
      respawn: e.RespawnLocationType && e.RespawnLocationType !== 'None' ? e.RespawnLocationType : null,
      blockTravel: !!e.BlockTravel,
    };
  }
  return out;
}

const MINING_GROUP = [
  [/^spaceship_mineables$/i, 'ship', 'Mining con nave'],
  [/^groundvehicle_mineables$/i, 'vehicle', 'Mining con veicolo di superficie'],
  [/^fps[ _]mineables$/i, 'fps', 'Mining a piedi (FPS)'],
  [/^ha(r)?vestables$/i, 'harvest', 'Raccolta (harvestable)'],
];
const TIER = [[/legendary/i, 'leggendario'], [/epic/i, 'epico'], [/rare/i, 'raro'], [/uncommon/i, 'non comune'], [/common/i, 'comune']];
const tierOf = (s) => TIER.find(([re]) => re.test(s ?? ''))?.[1] ?? null;

/**
 * Risorse estraibili per luogo dai file di gioco. Si dichiara solo "puo' generarsi qui" (tabella di
 * generazione del gioco), MAI un giacimento confermato; i gruppi di recupero relitti sono esclusi.
 * @param resolve (name, system, type) -> placeId|null (abbinamento univoco o niente)
 */
export function buildMining(locations, resources, { resolve = () => null, patch = null } = {}) {
  const R = new Map((resources ?? []).map((r) => [r.UUID, r]));
  const out = {}; const unmatched = [];
  for (const prov of locations ?? []) {
    const groups = [];
    for (const g of prov.Groups ?? []) {
      if (/salvage|loot|remains/i.test(g.GroupName)) continue; // recupero relitti e bottino: fuori da NAVCOM
      const m = MINING_GROUP.find(([re]) => re.test(g.GroupName));
      const kind = m?.[1] ?? 'other';
      const mats = new Map();
      for (const d of g.Deposits ?? []) {
        const r = R.get(d.ResourceUUID); if (!r) continue;
        const parts = r.Composition?.Parts ?? [];
        const tier = tierOf(r.Tier) ?? tierOf(r.Key);
        const names = parts.length ? parts.map((p) => clean(p.Name)?.replace(/\s*\((Ore|Raw)\)$/i, '')) : [clean(r.Name)];
        for (const n of names.filter(Boolean)) {
          const prev = mats.get(n);
          if (!prev) mats.set(n, { name: n, tiers: new Set(tier ? [tier] : []), deposits: new Set([clean(r.Composition?.DepositName) ?? null].filter(Boolean)) });
          else { if (tier) prev.tiers.add(tier); if (r.Composition?.DepositName) prev.deposits.add(r.Composition.DepositName); }
        }
      }
      if (mats.size) groups.push({ kind, label: m?.[2] ?? g.GroupName, group: g.GroupName, materials: [...mats.values()].map((x) => ({ name: x.name, tiers: [...x.tiers], deposits: [...x.deposits] })).sort((a, b) => a.name.localeCompare(b.name)) });
    }
    if (!groups.length) continue;
    for (const loc of prov.Locations ?? []) {
      const id = resolve(loc.Name, sysKey(loc.System), loc.Type);
      const entry = { provider: prov.Provider?.Name ?? null, locationType: loc.Type ?? null, groups, source: 'scu', patch };
      if (!id) { unmatched.push({ name: loc.Name, system: sysKey(loc.System), type: loc.Type, provider: entry.provider }); continue; }
      (out[id] ??= []).push(entry);
    }
  }
  return { byPlace: out, unmatched };
}

// ------------------------------------------------------------------ ambiente (starmap.space)

/** Nome starmap.space -> candidati di nome della starmap del gioco ("Pyro1" -> "Pyro I", "Microtech"). */
export function smNameCandidates(n) {
  const s = String(n ?? '').trim(); const out = [s];
  const m = s.match(/^([A-Za-z]+)\s*(\d{1,2})$/); if (m && ROMAN[+m[2]]) out.push(`${m[1]} ${ROMAN[+m[2]]}`);
  out.push(s.replace(/ Star$/i, ''));
  return [...new Set(out)];
}

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(+v) ? null : +v);
const flag = (v) => (v === null || v === undefined || v === '' ? null : String(v) === '1' || v === true);

/**
 * Corpi celesti di starmap.space -> condizioni ambientali per uuid del corpo.
 * Un valore assente resta null. La gravita' identica per quasi tutti i corpi di un sistema e'
 * segnalata come sospetta (probabile valore predefinito della fonte), non usata come dato.
 */
export function buildEnvironment(ocBySystem, { resolve = () => null, fetchedAt = null } = {}) {
  const out = {}; const unmatched = []; const suspect = {};
  for (const [sys, rows] of Object.entries(ocBySystem ?? {})) {
    const bodies = (rows ?? []).filter((o) => /^(planet|moon|star)$/i.test(o.Type ?? ''));
    const gs = bodies.map((o) => num(o.Gravitation)).filter((g) => g !== null);
    const same = gs.length >= 4 && gs.filter((g) => g === gs[0]).length / gs.length >= 0.8;
    if (same) suspect[sys] = `gravità ${gs[0]} g per ${gs.filter((g) => g === gs[0]).length} corpi su ${gs.length}: valore probabilmente predefinito della fonte`;
    for (const o of bodies) {
      let id = null;
      for (const c of smNameCandidates(o.ObjectContainer)) { id = resolve(c, sysKey(sys)); if (id) break; }
      if (!id) for (const c of smNameCandidates(o.InternalName)) { id = resolve(c, sysKey(sys)); if (id) break; }
      const rec = {
        smName: o.ObjectContainer, smType: o.Type,
        tempMin: num(o.SurfaceMinTemp), tempMax: num(o.SurfaceMaxTemp),
        breathable: flag(o.AtmosphereBreathable),
        composition: clean(o.AtmosphericComposition),
        atmosphereHeight: num(o.AtmosphereHeight),
        gravity: same ? null : num(o.Gravitation), gravityRaw: num(o.Gravitation), gravitySuspect: same ? suspect[sys] : null,
        habitable: flag(o.Habitable), oceans: flag(o.Oceans),
        biomes: clean(o.Biomes), classification: clean(o.Classification),
        jurisdiction: clean(o.Jurisdiction), affiliation: clean(o.Affiliation),
        radius: num(o.BodyRadius) || null,
        comment: clean(o.Comment), submitted: clean(o.Submitted), fetchedAt, source: 'sm',
      };
      if (!id) { unmatched.push({ name: o.ObjectContainer, system: sysKey(sys) }); continue; }
      out[id] = rec;
    }
  }
  return { byPlace: out, unmatched, suspect };
}

/** POI di starmap.space (armistizio, no-fly, trespassing, pad, servizi, minerali), se l'endpoint risponde. */
export function buildSmPois(rows, { resolve = () => null } = {}) {
  const out = {}; const unmatched = [];
  for (const p of rows ?? []) {
    const id = resolve(p.PoiName, sysKey(p.System));
    const rec = {
      name: p.PoiName, planet: p.Planet, type: clean(p.Type), poiType: clean(p.POI_Type), faction: clean(p.POI_Faction),
      armistice: flag(p.Zone_Armistice), noFly: flag(p.Zone_NoFly), trespassing: flag(p.Zone_Trespassing),
      atmosphere: clean(p.POI_Atmosphere ?? p.POI_Athmosphere), tempMin: num(p.Zone_Temperature_Min), tempMax: num(p.Zone_Temperature_Max),
      gravity: num(p.Zone_Gravitation), biome: clean(p.Zone_Biome), defenses: clean(p.POI_Defenses),
      landingPads: clean(p.POI_LandingPads), vehiclePads: clean(p.POI_VehiclePads), services: clean(p.POI_Services), medBay: clean(p.POI_MedBay),
      minerals: clean(p.Minerals), lastUpdate: clean(p.LastUpdate), introduced: clean(p.Introduced), source: 'sm',
    };
    if (!id) { unmatched.push({ name: p.PoiName, system: sysKey(p.System) }); continue; }
    out[id] = rec;
  }
  return { byPlace: out, unmatched };
}

// ------------------------------------------------------------------ UEX (community)

const UEX_FLAGS = ['is_armistice', 'is_landable', 'is_decommissioned', 'has_quantum_marker', 'has_trade_terminal', 'has_habitation', 'has_refinery', 'has_cargo_center', 'has_clinic', 'has_food', 'has_shops', 'has_refuel', 'has_repair', 'has_gravity', 'has_loading_dock', 'has_docking_port', 'has_freight_elevator'];
const TERM_FLAGS = ['is_habitation', 'is_refinery', 'is_cargo_center', 'is_medical', 'is_food', 'is_shop_fps', 'is_shop_vehicle', 'is_refuel', 'is_repair', 'is_auto_load', 'has_loading_dock', 'has_docking_port', 'has_freight_elevator', 'is_player_owned'];
const pickFlags = (r, keys) => Object.fromEntries(keys.filter((k) => r[k] !== undefined && r[k] !== null).map((k) => [k, !!+r[k]]));
const ts = (v) => (num(v) ? new Date(num(v) * 1000).toISOString() : null);

/**
 * Luoghi e terminali UEX, abbinati alla starmap del gioco.
 * @param raw {space_stations, cities, outposts, poi, terminals, ...}
 * @param resolve (name, system) -> {id, how}|{ambiguous:[ids]}|null
 */
export function buildUexPlaces(raw, { resolve = () => null } = {}) {
  const locs = {}; const kinds = [['space_stations', 'station'], ['cities', 'city'], ['outposts', 'outpost'], ['poi', 'poi']];
  for (const [key, kind] of kinds) {
    for (const r of raw[key] ?? []) {
      if (r.is_available === 0 || r.is_visible === 0) continue;
      const system = sysKey(r.star_system_name);
      let m = resolve(r.name, system);
      if (!m && r.nickname && r.nickname !== r.name) m = resolve(r.nickname, system);
      const k = `${kind}:${r.id}`;
      locs[k] = {
        key: k, uexId: r.id, kind, name: r.name, nickname: r.nickname && r.nickname !== r.name ? r.nickname : null, system,
        planet: r.planet_name ?? null, moon: r.moon_name ?? null, orbit: r.orbit_name ?? null,
        poiType: r.type ?? null, poiSubtype: r.subtype ?? null, mining: r.is_mining_related != null ? !!+r.is_mining_related : null,
        flags: pickFlags(r, UEX_FLAGS), pads: clean(r.pad_types),
        faction: r.faction_name ?? null, jurisdiction: r.jurisdiction_name ?? null,
        live: r.is_available_live != null ? !!+r.is_available_live : null,
        added: ts(r.date_added), modified: ts(r.date_modified),
        placeId: m?.id ?? null, linkHow: m?.how ?? null, candidates: m?.ambiguous ?? [], source: 'uex',
      };
    }
  }
  const terminals = {};
  const parentKey = (t) => (t.id_space_station ? `station:${t.id_space_station}` : t.id_outpost ? `outpost:${t.id_outpost}` : t.id_city ? `city:${t.id_city}` : t.id_poi ? `poi:${t.id_poi}` : null);
  for (const t of raw.terminals ?? []) {
    if (t.is_available === 0 || t.is_visible === 0) continue;
    const lk = parentKey(t); const loc = lk ? locs[lk] : null;
    let placeId = loc?.placeId ?? null; let how = loc?.placeId ? `tramite ${loc.name}` : null;
    if (!placeId && !loc) { const m = resolve(t.displayname ?? t.nickname ?? t.name, sysKey(t.star_system_name)); placeId = m?.id ?? null; how = m?.how ?? null; }
    terminals[t.id] = {
      id: t.id, name: t.name, fullname: t.fullname ?? null, displayname: t.displayname ?? null, code: t.code ?? null, type: t.type ?? null,
      system: sysKey(t.star_system_name), planet: t.planet_name ?? null, moon: t.moon_name ?? null,
      locKey: lk, placeId, linkHow: how, flags: pickFlags(t, TERM_FLAGS),
      maxContainer: num(t.max_container_size), company: t.company_name ?? null, gameVersion: clean(t.game_version),
      live: t.is_available_live != null ? !!+t.is_available_live : null, modified: ts(t.date_modified), source: 'uex',
    };
  }
  return { locations: locs, terminals };
}

/** Prezzi UEX in forma compatta. Le date restano per ogni riga: un prezzo senza data non si mostra come attuale. */
export function buildMarket(raw, { fetchedAt = null } = {}) {
  const cats = Object.fromEntries((raw.categories ?? []).map((c) => [c.id, { id: c.id, type: c.type, section: c.section, name: c.name, mining: !!+c.is_mining }]));
  const items = {}; const itemPrices = [];
  for (const p of raw.items_prices_all ?? []) {
    if (!p.id_item || !p.id_terminal) continue;
    items[p.id_item] ??= [p.item_name, p.id_category ?? null, p.item_uuid ?? null];
    itemPrices.push([p.id_item, p.id_terminal, num(p.price_buy) || 0, num(p.price_sell) || 0, num(p.date_modified) ?? num(p.date_added)]);
  }
  const commodities = {};
  for (const c of raw.commodities ?? []) {
    commodities[c.id] = { id: c.id, name: c.name, code: c.code ?? null, kind: c.kind ?? null, illegal: !!+c.is_illegal, raw: !!+c.is_raw, refined: !!+c.is_refined, mineral: !!+c.is_mineral, harvestable: !!+c.is_harvestable, buyable: !!+c.is_buyable, sellable: !!+c.is_sellable, volatileQt: !!+c.is_volatile_qt, explosive: !!+c.is_explosive };
  }
  const commodityPrices = [];
  for (const p of raw.commodities_prices_all ?? []) {
    if (!p.id_commodity || !p.id_terminal) continue;
    commodities[p.id_commodity] ??= { id: p.id_commodity, name: p.commodity_name };
    // [commodity, terminal, buy, sell, scuBuy, scuSellStock, scuSell(domanda), statusBuy, statusSell, containerSizes, date]
    commodityPrices.push([p.id_commodity, p.id_terminal, num(p.price_buy) || 0, num(p.price_sell) || 0, num(p.scu_buy), num(p.scu_sell_stock), num(p.scu_sell), num(p.status_buy), num(p.status_sell), clean(p.container_sizes), num(p.date_modified) ?? num(p.date_added)]);
  }
  const fuel = (raw.fuel_prices_all ?? []).map((f) => [f.commodity_name, f.id_terminal, num(f.price_buy), num(f.date_modified) ?? num(f.date_added)]);
  return { meta: { source: 'uex', fetchedAt, items: Object.keys(items).length, itemPrices: itemPrices.length, commodityPrices: commodityPrices.length }, categories: cats, items, itemPrices, commodities, commodityPrices, fuel };
}

/** Navi per PREPARA SPEDIZIONE (file di gioco): carburante, quantum, stiva, ruolo. Nessun valore stimato. */
export function buildExpeditionShips(ships, { patch = null } = {}) {
  const out = new Map();
  for (const s of ships ?? []) {
    if (!s?.Name || /_Display$|_Template$|_AI_|_PU_AI|_Unmanned|_NoInterior/i.test(s.ClassName ?? '') || PLACEHOLDER.test(s.Name)) continue;
    if (!s.IsSpaceship && !s.IsVehicle) continue;
    if (out.has(s.Name)) continue;
    out.set(s.Name, {
      id: s.ClassName, name: s.Name, career: s.Career ?? null, role: s.Role ?? null, size: s.Size ?? null,
      vehicle: !!s.IsVehicle && !s.IsSpaceship, crew: s.Crew ?? null, cargo: num(s.Cargo),
      fuelH: num(s.Propulsion?.FuelCapacity), fuelQt: num(s.QuantumTravel?.FuelCapacity), qtRange: num(s.QuantumTravel?.Range),
      mining: /mining/i.test(`${s.Role ?? ''} ${s.Career ?? ''}`), patch,
    });
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Risolutore "fonte -> uuid della starmap" sul database geografico dell'atlante. Solo corrispondenze
 * univoche nel sistema; se ci sono piu' luoghi con lo stesso nome restituisce i candidati.
 */
export function makeResolver(geo) {
  return (name, system) => {
    if (!name) return null;
    const r = geo.resolve(name, system ?? null);
    if (r?.place && (!system || r.place.system === system)) return { id: r.place.id, how: r.how };
    const same = (geo.names.get(normName(name)) ?? []).filter((p) => !system || p.system === system);
    const ids = [...new Set(same.map((p) => p.id))];
    return ids.length > 1 ? { id: null, how: null, ambiguous: ids } : null;
  };
}
