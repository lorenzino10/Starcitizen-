// DATABASE PUNTI: importazione, modifica, cancellazione, persistenza, esportazione.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { IDBFactory } from 'fake-indexeddb';
import {
  parseNumber, parseSystem, parseUnit, parseDate, normalizePoint, toMeters, isComplete, duplicateReason, findDuplicates,
  filterPoints, guessMapping, rowsToCandidates, planImport, exportRows, backupJson, parseBackup, fromLegacy, plausibility,
} from '../js/core/points.js';
import { readXlsx, writeXlsx } from '../js/data/xlsx.js';
import { PointsDB } from '../js/data/pointsdb.js';

const FIXTURE = new URL('./fixtures/punti_esempio.xlsx', import.meta.url);
const pt = (o) => normalizePoint({ unit: 'km', system: 'stanton', ...o }).point;

async function fixtureCandidates(opts = {}) {
  const { sheets } = await readXlsx(new Uint8Array(await readFile(FIXTURE)));
  const [header, ...rows] = sheets[0].rows;
  return rowsToCandidates(rows, guessMapping(header), opts);
}

// ------------------------------------------------------------ parsing e validazione
test('numeri: formati italiano, inglese, scientifico, ambigui', () => {
  assert.equal(parseNumber('12.850.457,093').value, 12850457.093);
  assert.equal(parseNumber('1,234.5').value, 1234.5);
  assert.equal(parseNumber('-0,5').value, -0.5);
  assert.equal(parseNumber('1 234,5').value, 1234.5);
  assert.equal(parseNumber('-1.2e9').value, -1.2e9);
  assert.equal(parseNumber(42).value, 42);
  assert.equal(parseNumber('').value, null);
  const amb = parseNumber('1.234');
  assert.equal(amb.value, 1.234); assert.match(amb.warning, /ambiguo/);
  assert.match(parseNumber('abc').error, /non è un numero/);
});

test('sistema, unità, date', () => {
  assert.equal(parseSystem(' STANTON '), 'stanton'); assert.equal(parseSystem('Nyx'), 'nyx'); assert.equal(parseSystem('Andromeda'), null);
  assert.equal(parseUnit('KM'), 'km'); assert.equal(parseUnit('metri'), 'm'); assert.equal(parseUnit('mi'), null);
  assert.equal(parseDate('05/11/2026 14:30').value, '2026-11-05T14:30:00Z');
  assert.equal(parseDate(46000).value, '2025-12-09T00:00:00Z');
  assert.ok(parseDate('31/02/2026').error);
});

test('normalizePoint: errori bloccanti e avvisi', () => {
  assert.deepEqual(normalizePoint({ name: '', system: 'x' }).errors, ['nome mancante', 'sistema "x" sconosciuto (ammessi: Stanton, Pyro, Nyx)']);
  assert.match(normalizePoint({ name: 'a', system: 'pyro', x: 1, y: 2, z: 3 }).errors[0], /unità di misura mancante/);
  assert.match(normalizePoint({ name: 'a', system: 'pyro', x: 1, y: 2, z: 3, unit: 'mi' }).errors[0], /non valida/);
  const r = normalizePoint({ name: 'Scheda', system: 'pyro', x: 5, unit: 'm', category: 'boh', status: '?' });
  assert.equal(r.complete, false); assert.equal(r.point.category, 'Altro'); assert.equal(r.point.status, 'Da verificare');
  assert.equal(r.point.y, null);
  assert.equal(toMeters(r.point), null, 'una scheda incompleta non ha coordinate per il pianificatore');
  const ok = pt({ name: 'P', x: 1, y: -2, z: 0.5 });
  assert.deepEqual(toMeters(ok), { x: 1000, y: -2000, z: 500 });
  assert.ok(ok.id && ok.createdAt && ok.updatedAt);
});

test('plausibilità: avvisa ma non blocca', () => {
  const far = pt({ name: 'lontano', x: 9e9, y: 0, z: 0 }); // 9e12 m
  assert.match(plausibility(far, 3e10).join(' '), /oltre i dati/);
  assert.deepEqual(plausibility(pt({ name: 'ok', x: 1e7, y: 0, z: 0 }), 3e10), []);
});

test('duplicati: stesse coordinate entro 1 m o stesso nome, solo nello stesso sistema', () => {
  const a = pt({ name: 'Relitto', x: 100, y: 200, z: 300 });
  const b = pt({ name: 'Altro nome', x: 100.0005, y: 200, z: 300 }); // 0,5 m
  const c = pt({ name: ' relitto ', x: 1, y: 1, z: 1 });
  const d = pt({ name: 'Relitto', system: 'pyro', x: 100, y: 200, z: 300 });
  assert.equal(duplicateReason(a, b), 'coordinate');
  assert.equal(duplicateReason(a, c), 'nome');
  assert.equal(duplicateReason(a, d), null);
  assert.deepEqual(findDuplicates([a, b, c, d]).map((g) => g.ids.length), [3]);
});

test('filtri: nome, sistema, categoria, risorsa, stato, solo completi', () => {
  const list = [
    pt({ name: 'Campo Quantanium', category: 'Mining', resource: 'Quantanium', status: 'Verificato', x: 1, y: 1, z: 1 }),
    pt({ name: 'Relitto Idris', system: 'pyro', category: 'Relitto', x: 1, y: 1, z: 1 }),
    pt({ name: 'Scheda', x: 1 }),
  ];
  assert.equal(filterPoints(list, { q: 'quant' }).length, 1);
  assert.equal(filterPoints(list, { system: 'pyro' })[0].name, 'Relitto Idris');
  assert.equal(filterPoints(list, { category: 'Mining', resource: 'quanta', status: 'Verificato' }).length, 1);
  assert.equal(filterPoints(list, { completeOnly: true }).length, 2);
});

// ------------------------------------------------------------ importazione Excel
test('import xlsx: mappatura automatica delle colonne del file di esempio', async () => {
  const { sheets } = await readXlsx(new Uint8Array(await readFile(FIXTURE)));
  assert.equal(sheets[0].name, 'Miei punti');
  const m = guessMapping(sheets[0].rows[0]);
  assert.deepEqual(m, { name: 0, system: 1, x: 2, y: 3, z: 4, unit: 5, category: 6, resource: 7, status: 8, notes: 9, createdAt: 10, verifiedAt: 11 });
});

test('import xlsx: validazione, scheda incompleta, errori, duplicato nel file', async () => {
  const cands = await fixtureCandidates();
  assert.equal(cands.length, 6, 'la riga vuota è ignorata');
  const plan = planImport(cands, []);
  assert.deepEqual(plan.insert.map((p) => p.name), ['Relitto Idris', 'Campo quantanium', 'Scheda incompleta', 'Metri']);
  assert.deepEqual(plan.errors.map((e) => e.rowNo), [5]);
  assert.match(plan.errors[0].errors.join(), /Andromeda/);
  assert.deepEqual(plan.incomplete, [4]);
  assert.equal(plan.skipped.length, 1); assert.equal(plan.skipped[0].rowNo, 6); assert.match(plan.skipped[0].reason, /stesso file/);
  const q = plan.insert[1];
  assert.equal(q.system, 'stanton'); assert.equal(q.unit, 'km'); assert.equal(q.category, 'Mining'); assert.equal(q.status, 'Verificato');
  assert.equal(q.x, 12850457.093); assert.equal(q.y, 1234.5); assert.equal(q.z, -0.5);
  assert.equal(q.createdAt, '2026-09-15T00:00:00Z'); assert.equal(q.verifiedAt, '2026-10-02T00:00:00Z');
  const metri = plan.insert[3];
  assert.equal(metri.unit, 'm'); assert.equal(metri.status, 'Non interessante'); assert.deepEqual(toMeters(metri), { x: 1.5e9, y: -2e9, z: 0 });
  assert.equal(planImport(cands, [], { keepIncomplete: false }).insert.length, 3);
});

test('import xlsx: secondo file con duplicati -> ignora oppure aggiorna', async () => {
  const first = planImport(await fixtureCandidates(), []).insert;
  const idris = first.find((p) => p.name === 'Relitto Idris');
  const again = await fixtureCandidates();
  const ign = planImport(again, first, { onDuplicate: 'ignore' });
  assert.equal(ign.insert.length, 0); assert.equal(ign.update.length, 0); assert.equal(ign.skipped.length, 5);
  const modified = again.map((c) => (c.point?.name === 'Relitto Idris' ? { ...c, point: { ...c.point, notes: 'aggiornato' } } : c));
  const upd = planImport(modified, first, { onDuplicate: 'update' });
  assert.equal(upd.insert.length, 0);
  assert.equal(upd.update.length, 4);
  const u = upd.update.find((x) => x.before.id === idris.id);
  assert.equal(u.after.id, idris.id, "l'ID resta lo stesso");
  assert.equal(u.after.createdAt, idris.createdAt, 'la data di inserimento resta quella originale');
  assert.equal(u.after.notes, 'aggiornato');
  assert.match(upd.skipped.find((s) => s.rowNo === 6).reason, /stesso file/);
});

// ------------------------------------------------------------ archivio IndexedDB
test('IndexedDB: inserimento, modifica, cancellazione e persistenza dopo la riapertura', async () => {
  const factory = new IDBFactory();
  let db = await PointsDB.open({ indexedDB: factory });
  assert.equal(db.persistent, true); assert.equal(db.warning, null);
  let changes = 0; db.onChange(() => changes++);
  const a = pt({ name: 'Bravo', x: 1, y: 2, z: 3 }), b = pt({ name: 'alfa', x: 4, y: 5, z: 6 }), c = pt({ name: 'Charlie', x: 7 });
  await db.put(a); await db.putMany([b, c]);
  assert.deepEqual((await db.all()).map((p) => p.name), ['alfa', 'Bravo', 'Charlie']);
  await db.put({ ...a, status: 'Verificato', notes: 'visto', y: 2.5 });
  assert.equal((await db.get(a.id)).notes, 'visto');
  assert.equal(changes, 3);
  db.close();

  db = await PointsDB.open({ indexedDB: factory }); // come dopo la chiusura del browser
  assert.equal((await db.all()).length, 3);
  const ra = await db.get(a.id);
  assert.equal(ra.status, 'Verificato'); assert.equal(ra.y, 2.5);
  await db.delete(c.id);
  assert.equal(await db.get(c.id), null);
  await db.deleteMany([a.id, b.id]);
  assert.equal((await db.all()).length, 0);
  await db.replaceAll([a, b, c]);
  await db.replaceAll([c]);
  assert.deepEqual((await db.all()).map((p) => p.id), [c.id]);
  db.close();
});

test('IndexedDB: migrazione dei vecchi punti personali una sola volta', async () => {
  const factory = new IDBFactory();
  const db = await PointsDB.open({ indexedDB: factory });
  const legacy = [{ id: 'cp1', name: 'Vecchio', system: 'stanton', x: 1e9, y: 0, z: -5, createdAt: '2026-11-01T10:00:00Z' }];
  assert.equal(await db.migrateLegacy(legacy), 1);
  const [m] = await db.all();
  assert.equal(m.unit, 'm'); assert.equal(m.category, 'Punto personale'); assert.equal(m.source, 'migrazione'); assert.equal(m.legacyId, 'cp1');
  assert.equal(m.createdAt, '2026-11-01T10:00:00Z');
  assert.equal(await db.migrateLegacy(legacy), 0);
  await db.delete(m.id);
  assert.equal(await db.migrateLegacy(legacy), 0, 'un punto eliminato non ricompare');
  assert.equal((await db.all()).length, 0);
  assert.equal(fromLegacy({ id: 'x', name: '', system: 'stanton' }).point, null);
  db.close();
});

test('IndexedDB assente o in errore: archivio in memoria con avviso esplicito', async () => {
  const none = await PointsDB.open({ indexedDB: null });
  assert.equal(none.persistent, false); assert.match(none.warning, /NON verranno salvati/);
  await none.put(pt({ name: 'temp', x: 1, y: 1, z: 1 }));
  assert.equal((await none.all()).length, 1);
  const broken = { open() { throw Object.assign(new Error('blocked'), { name: 'SecurityError' }); } };
  const b = await PointsDB.open({ indexedDB: broken });
  assert.equal(b.persistent, false); assert.match(b.warning, /Archivio permanente non disponibile/);
});

// ------------------------------------------------------------ esportazione e backup
test('export Excel: il file esportato si reimporta identico', async () => {
  const src = planImport(await fixtureCandidates(), []).insert;
  const buf = await writeXlsx(exportRows(src), 'Punti NAVCOM');
  const { sheets } = await readXlsx(buf);
  assert.equal(sheets[0].name, 'Punti NAVCOM');
  const [header, ...rows] = sheets[0].rows;
  const back = planImport(rowsToCandidates(rows, guessMapping(header)), []).insert;
  assert.equal(back.length, src.length);
  for (let i = 0; i < src.length; i++) {
    const s = src.find((p) => p.id === back[i].id);
    assert.ok(s, 'ID conservato');
    for (const k of ['name', 'system', 'x', 'y', 'z', 'unit', 'category', 'resource', 'status', 'notes']) assert.deepEqual(back[i][k], s[k], k);
    assert.equal(back[i].createdAt.slice(0, 16), s.createdAt.slice(0, 16));
  }
  assert.equal(planImport(rowsToCandidates(rows, guessMapping(header)), src).insert.length, 0, 'reimportare lo stesso file non crea doppioni');
});

test('backup JSON: ripristino esatto, file estranei rifiutati', async () => {
  const src = planImport(await fixtureCandidates(), []).insert;
  const restored = parseBackup(backupJson(src));
  assert.deepEqual(restored, src);
  assert.deepEqual(parseBackup(JSON.stringify(src)), src, 'accetta anche un semplice array');
  assert.throws(() => parseBackup('{"version":1}'), /non riconosciuto/);
  const db = await PointsDB.open({ indexedDB: new IDBFactory() });
  await db.replaceAll(restored);
  assert.equal((await db.all()).length, src.length);
  assert.ok((await db.all()).every((p) => isComplete(p) || p.name === 'Scheda incompleta'));
  db.close();
});

// ------------------------------------------------------------ 0.5.1: classificazione, file .NET, grandi volumi
import { writeZip } from '../js/data/xlsx.js';
import { DupIndex, parsePriority, parseStatus } from '../js/core/points.js';

test('xlsx con prefissi di namespace (OpenXML SDK / .NET) e percorsi assoluti', async () => {
  const enc = (s) => new TextEncoder().encode(s);
  const NS = 'xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const buf = writeZip([
    ['[Content_Types].xml', enc('<?xml version="1.0"?><Types/>')],
    ['xl/workbook.xml', enc(`<?xml version="1.0" encoding="utf-8"?><x:workbook ${NS}><x:sheets><x:sheet name="IMPORT NAVCOM" sheetId="1" r:id="R1" ${R} /></x:sheets></x:workbook>`)],
    ['xl/_rels/workbook.xml.rels', enc('﻿<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Type="x/worksheet" Target="/xl/worksheets/sheet1.xml" Id="R1" /><Relationship Type="x/sharedStrings" Target="/xl/sharedStrings.xml" Id="R2" /></Relationships>')],
    ['xl/sharedStrings.xml', enc(`<x:sst ${NS}><x:si><x:t>Sistema</x:t></x:si></x:sst>`)],
    ['xl/worksheets/sheet1.xml', enc(`<x:worksheet ${NS}><x:sheetData><x:row r="1"><x:c r="A1" t="str"><x:v>Nome</x:v></x:c><x:c r="B1" t="s"><x:v>0</x:v></x:c><x:c r="C1" t="inlineStr"><x:is><x:t>X</x:t></x:is></x:c></x:row><x:row r="2"><x:c r="A2" t="str"><x:v>Aberdeen</x:v></x:c><x:c r="B2" t="str"><x:v>Stanton</x:v></x:c><x:c r="C2"><x:v>12905757.636</x:v></x:c></x:row></x:sheetData></x:worksheet>`)],
  ]);
  const { sheets } = await readXlsx(buf);
  assert.equal(sheets[0].name, 'IMPORT NAVCOM');
  assert.deepEqual(sheets[0].rows, [['Nome', 'Sistema', 'X'], ['Aberdeen', 'Stanton', 12905757.636]]);
});

test('classificazione, priorità, fonte dei dati: import, filtri, export', async () => {
  assert.equal(parseStatus('Da georeferenziare'), 'Da verificare');
  assert.equal(parsePriority('ALTA'), 'Alta'); assert.equal(parsePriority('NON ASSEGNATA'), ''); assert.equal(parsePriority('urgente'), null);
  const header = ['ID', 'Nome', 'Sistema', 'X', 'Y', 'Z', 'Unità', 'Categoria', 'Classificazione', 'Priorità', 'Risorsa cercata', 'Stato', 'Note', 'Fonte dei dati'];
  const rows = [
    ['PI-1', 'Grotta A', 'Stanton', null, null, null, 'km', 'Esplorazione', 'Grotte', 'ALTA', 'Hadanite', 'Da georeferenziare', 'n', 'starmap.space'],
    ['PI-2', 'Base B', 'Pyro', 1, 2, 3, 'km', 'Mining', 'Basi su asteroide (Pyro)', 'NON ASSEGNATA', null, 'Da verificare', null, 'Wiki API'],
    ['PI-3', 'Strano', 'Nyx', 1, 2, 3, 'km', 'Altro', 'Anomalie', 'urgente', null, 'Da verificare', null, null],
  ];
  const m = guessMapping(header);
  assert.equal(m.group, 8); assert.equal(m.priority, 9); assert.equal(m.resource, 10); assert.equal(m.sourceRef, 13);
  const cands = rowsToCandidates(rows, m);
  assert.deepEqual(cands[0].warnings, ['nessuna coordinata: scheda incompleta'], 'nessun avviso per "Da georeferenziare" e "ALTA"');
  assert.match(cands[2].warnings.join(), /priorità "urgente"/);
  const pts = planImport(cands, []).insert;
  assert.deepEqual(pts.map((p) => [p.id, p.group, p.priority, p.status, p.sourceRef]), [
    ['PI-1', 'Grotte', 'Alta', 'Da verificare', 'starmap.space'],
    ['PI-2', 'Basi su asteroide (Pyro)', '', 'Da verificare', 'Wiki API'],
    ['PI-3', 'Anomalie', '', 'Da verificare', ''],
  ]);
  assert.deepEqual(filterPoints(pts, { group: 'Grotte' }).map((p) => p.id), ['PI-1']);
  assert.deepEqual(filterPoints(pts, { priority: 'Alta' }).map((p) => p.id), ['PI-1']);
  assert.deepEqual(filterPoints(pts, { priority: '-' }).map((p) => p.id), ['PI-2', 'PI-3']);
  const { sheets } = await readXlsx(await writeXlsx(exportRows(pts)));
  const [h2, ...r2] = sheets[0].rows;
  const back = planImport(rowsToCandidates(r2, guessMapping(h2)), []).insert;
  assert.deepEqual(back.map((p) => [p.id, p.group, p.priority, p.sourceRef]), pts.map((p) => [p.id, p.group, p.priority, p.sourceRef]));
  assert.deepEqual(parseBackup(backupJson(pts)), pts);
});

test('grandi volumi: 4000 punti, duplicati e import in tempi brevi, stessi risultati del confronto a coppie', () => {
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const sys = ['stanton', 'pyro', 'nyx'];
  const pts = Array.from({ length: 4000 }, (_, i) => pt({ name: `P${i % 3700}`, system: sys[i % 3], unit: 'm', x: Math.round(rnd() * 1e6) * 1000, y: Math.round(rnd() * 1e6) * 1000, z: 0 }));
  pts[10] = { ...pts[10], x: pts[20].x + 0.5, y: pts[20].y, z: pts[20].z, system: pts[20].system }; // stesse coordinate entro 1 m
  let t = performance.now();
  const groups = findDuplicates(pts);
  const tDup = performance.now() - t;
  const brute = [];
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) if (duplicateReason(pts[i], pts[j])) brute.push(`${pts[i].id}|${pts[j].id}`);
  const fromGroups = new Set(groups.flatMap((g) => g.ids.slice(1).map((id) => `${g.ids[0]}|${id}`)));
  for (const pair of brute) assert.ok(fromGroups.has(pair), pair);
  assert.ok(groups.some((g) => g.reason === 'coordinate'));
  t = performance.now();
  const plan = planImport(pts.map((p, i) => ({ rowNo: i + 2, point: { ...p, id: undefined }, errors: [], warnings: [], complete: true })), pts.slice(0, 2000));
  const tPlan = performance.now() - t;
  assert.ok(plan.skipped.length >= 2000);
  assert.ok(tDup < 1500 && tPlan < 1500, `troppo lento: duplicati ${tDup | 0} ms, import ${tPlan | 0} ms`);
  const idx = new DupIndex([pts[20]]);
  assert.equal(idx.find({ ...pts[10], id: 'nuovo', name: 'altro' }).reason, 'coordinate');
});

// ------------------------------------------------------------ 0.5.4: coordinate planetarie, aggiornamento non distruttivo
import { hasPlanetary, mergeUpdate } from '../js/core/points.js';

test('coordinate planetarie: conservate, validate, MAI convertite in XYZ di sistema', async () => {
  const header = ['ID', 'Nome', 'Sistema', 'X', 'Y', 'Z', 'Unità', 'Corpo celeste', 'Latitudine', 'Longitudine', 'Altitudine (m)', 'X locale (km)', 'Y locale (km)', 'Z locale (km)', 'Sistema di riferimento planetario', 'Metodo di origine', 'Fonte risorse'];
  const rows = [
    ['G1', 'Grotta su Daymar', 'Stanton', null, null, null, 'km', 'Daymar', '-12,5', 45.25, 120, 100.5, -200.25, 30, 'lat/lon del corpo (ruotante)', 'starmap.space', 'scanner'],
    ['G2', 'Lat sbagliata', 'Stanton', null, null, null, 'km', 'Yela', 95, 10, null, null, null, null, null, null, null],
    ['S1', 'Stazione', 'Stanton', 1, 2, 3, 'km', 'Hurston', null, null, null, null, null, null, null, null, null],
  ];
  const m = guessMapping(header);
  for (const k of ['body', 'lat', 'lon', 'alt', 'localX', 'localY', 'localZ', 'planetFrame', 'method', 'resourceSource']) assert.ok(m[k] !== undefined, k);
  const c = rowsToCandidates(rows, m);
  const [g1, g2, s1] = planImport(c, []).insert;
  assert.deepEqual([g1.body, g1.lat, g1.lon, g1.alt, g1.localX, g1.localY, g1.localZ, g1.planetFrame, g1.method, g1.resourceSource],
    ['Daymar', -12.5, 45.25, 120, 100.5, -200.25, 30, 'lat/lon del corpo (ruotante)', 'starmap.space', 'scanner']);
  assert.deepEqual([g1.x, g1.y, g1.z], [null, null, null], 'nessuna conversione in XYZ di sistema');
  assert.equal(isComplete(g1), false); assert.equal(toMeters(g1), null); assert.ok(hasPlanetary(g1));
  assert.match(c[0].warnings.join(), /non convertite in XYZ/);
  assert.equal(g2.lat, null); assert.match(c[1].warnings.join(), /latitudine 95 fuori intervallo/);
  assert.ok(isComplete(s1)); assert.equal(s1.body, 'Hurston');
  // export -> reimport: tutto conservato
  const { sheets } = await readXlsx(await writeXlsx(exportRows([g1, g2, s1])));
  const [h2, ...r2] = sheets[0].rows;
  const back = planImport(rowsToCandidates(r2, guessMapping(h2)), []).insert;
  const keys = ['body', 'lat', 'lon', 'alt', 'localX', 'localY', 'localZ', 'planetFrame', 'method', 'resourceSource', 'x', 'y', 'z'];
  assert.deepEqual(back.map((p) => keys.map((k) => p[k])), [g1, g2, s1].map((p) => keys.map((k) => p[k])));
  assert.deepEqual(parseBackup(backupJson([g1])), [g1]);
});

test('import in modalità "aggiorna": cambia solo i campi presenti nel file, il resto resta', () => {
  const existing = planImport(rowsToCandidates(
    [['PI-1', 'Grotta', 'Stanton', null, null, null, 'km', 'Esplorazione', 'Grotte', 'Alta', 'Daymar', -1, 2]],
    guessMapping(['ID', 'Nome', 'Sistema', 'X', 'Y', 'Z', 'Unità', 'Categoria', 'Classificazione', 'Priorità', 'Corpo celeste', 'Latitudine', 'Longitudine'])), []).insert;
  // secondo file senza classificazione, priorità e lat/lon (come il foglio IMPORT NAVCOM)
  const cands = rowsToCandidates([['PI-1', 'Grotta', 'Stanton', 'nuova nota', 'starmap.space']], guessMapping(['ID', 'Nome', 'Sistema', 'Note', 'Metodo di origine']));
  const { update, insert } = planImport(cands, existing, { onDuplicate: 'update' });
  assert.equal(insert.length, 0); assert.equal(update.length, 1);
  const a = update[0].after;
  assert.deepEqual([a.id, a.group, a.priority, a.category, a.body, a.lat, a.lon, a.notes, a.method, a.createdAt],
    ['PI-1', 'Grotte', 'Alta', 'Esplorazione', 'Daymar', -1, 2, 'nuova nota', 'starmap.space', existing[0].createdAt]);
  // coordinate: si aggiornano insieme all'unità solo se il file le contiene
  const withXyz = mergeUpdate({ ...existing[0], x: 1, y: 2, z: 3, unit: 'km' }, { x: 5000, y: 6000, z: 7000, unit: 'm' }, ['x', 'y', 'z', 'unit']);
  assert.deepEqual([withXyz.x, withXyz.y, withXyz.z, withXyz.unit, withXyz.group], [5000, 6000, 7000, 'm', 'Grotte']);
});
