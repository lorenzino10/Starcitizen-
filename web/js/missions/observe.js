// Registrazione di un contratto visto nel MobiGlas a partire da un modello del catalogo (B8).
// Logica pura: precompila solo cio' che il catalogo da' per certo (titolo, datore, merce, cassa
// massima, luoghi FISSI). Ritiro e consegna da un pool restano vuoti: li scegli tu fra le
// alternative del pool (mai una scelta arbitraria). Quantita' e ricompensa sono quelle che leggi tu.

/** Righe di movimento iniziali dal modello. */
export function draftMovements(v, geo) {
  const picks = v.ops.filter((o) => o.role === 'pickup'), drops = v.ops.filter((o) => o.role === 'dropoff');
  const name = (o) => (o?.fixed && o.ids?.[0] ? geo.get(o.ids[0])?.name ?? '' : '');
  const pool = (o) => (o ? [...new Set([...(o.ids ?? []), ...(o.alt ?? [])])].map((id) => geo.get(id)?.name).filter(Boolean) : []);
  const rows = (drops.length ? drops : [null]).map((d, i) => {
    const pk = picks.find((o) => o.slot === d?.slot) ?? (picks.length === 1 ? picks[0] : null);
    const ord = v.orders?.[i] ?? v.orders?.[0] ?? null;
    return {
      cargo: d?.cargo ?? ord?.cargo ?? '', scu: '', containerMax: d?.containerMax ?? ord?.containerMax ?? v.maxBox ?? '',
      from: name(pk), to: name(d), fromPool: pool(pk), toPool: pool(d),
      scuRange: ord ? [ord.scuMin ?? null, ord.scuMax ?? null] : null,
    };
  });
  return rows;
}

/**
 * Input per normalizeContract (LOGISTICS) da modello + valori letti nel MobiGlas.
 * form = {status:'osservata'|'accettata', reward, offer, deadline, notes, movements:[{cargo, scu, containerMax, from, to}]}
 * @returns {{input, warnings:string[]}}
 */
export function observedInput(v, form, { geo, patch = null } = {}) {
  const warnings = [];
  const resolve = (n) => (n ? geo.resolveName(n) : null);
  const offerP = resolve(form.offer);
  const drafts = draftMovements(v, geo);
  // righe lasciate senza quantita' = movimenti del modello che il contratto reale non ha
  const filled = (form.movements ?? []).map((m, i) => ({ m, i })).filter(({ m }) => String(m.scu ?? '').trim() !== '');
  const skipped = (form.movements ?? []).length - filled.length;
  if (skipped && filled.length) warnings.push(`${skipped} movimenti del modello senza quantità: non inclusi nel contratto`);
  const movements = (filled.length ? filled : (form.movements ?? []).map((m, i) => ({ m, i }))).map(({ m, i }) => {
    const d = drafts[i];
    const fromP = resolve(m.from), toP = resolve(m.to);
    if (m.from && d?.fromPool?.length > 1 && !d.fromPool.includes(fromP?.name ?? m.from)) warnings.push(`movimento ${i + 1}: il ritiro "${m.from}" non è fra i ${d.fromPool.length} luoghi del pool del catalogo (patch diversa o pool incompleto?)`);
    if (m.to && d?.toPool?.length > 1 && !d.toPool.includes(toP?.name ?? m.to)) warnings.push(`movimento ${i + 1}: la consegna "${m.to}" non è fra i ${d.toPool.length} luoghi del pool del catalogo`);
    if (m.containerMax && v.maxBox && +m.containerMax > v.maxBox) warnings.push(`movimento ${i + 1}: cassa ${m.containerMax} SCU più grande del massimo del modello (${v.maxBox} SCU)`);
    return {
      id: `m${i + 1}`, cargo: m.cargo || null, scu: m.scu, containerMax: m.containerMax || null,
      from: m.from ? { name: fromP?.name ?? m.from, system: fromP?.system ?? null } : null,
      to: m.to ? { name: toP?.name ?? m.to, system: toP?.system ?? null } : null,
    };
  });
  const ri = v.rewardInfo ?? {};
  const reward = form.reward === '' || form.reward === null || form.reward === undefined ? null : +form.reward;
  if (reward !== null && ri.kind === 'fissa' && ri.min && reward !== ri.min) warnings.push(`ricompensa ${reward} diversa da quella fissa del catalogo (${ri.min}): vale quella del MobiGlas`);
  const system = offerP?.system ?? movements.find((m) => m.from?.system)?.from.system ?? v.system ?? v.systems?.[0] ?? null;
  return {
    warnings,
    input: {
      title: v.title, company: v.company, rank: v.rank, reward, status: form.status === 'accettata' ? 'accettata' : 'osservata',
      patch, system, offerZone: offerP?.name ?? (form.offer || null), deadline: form.deadline || null,
      source: 'MobiGlas (registrato da te)', notes: form.notes ?? '',
      catalogRef: { id: v.id, uuid: v.uuid ?? null, group: v.group ?? null, patch: v.patch ?? null, category: v.category ?? null },
      movements,
    },
  };
}
