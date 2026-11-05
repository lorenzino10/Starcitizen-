// GRAFO DI NAVIGAZIONE. Nodi = marker QT (+ partenza); archi = salti QT completi ammessi dalla
// modalita' scelta. Il grafo e' denso (da qualunque marker si puo' tentare un salto verso
// qualunque altro, se la linea non e' ostruita), quindi Dijkstra in versione O(n^2) a matrice:
// e' la variante ottimale per grafi densi e non richiede di materializzare gli archi.

/**
 * @param {number} n           numero di nodi
 * @param {number} src         nodo di partenza
 * @param {(u:number,v:number)=>number} weight  peso dell'arco u->v (Infinity = assente)
 * @returns {{dist:Float64Array, prev:Int32Array}}
 */
export function dijkstraDense(n, src, weight) {
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  dist[src] = 0;
  for (let it = 0; it < n; it++) {
    let u = -1, best = Infinity;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
    if (u < 0) break;
    done[u] = 1;
    for (let v = 0; v < n; v++) {
      if (done[v] || v === u) continue;
      const w = weight(u, v);
      if (w === Infinity) continue;
      const nd = best + w;
      if (nd < dist[v]) { dist[v] = nd; prev[v] = u; }
    }
  }
  return { dist, prev };
}

/** Sequenza di nodi da src a dst (vuota se irraggiungibile). */
export function pathTo(prev, src, dst) {
  if (src === dst) return [src];
  if (prev[dst] < 0) return [];
  const out = [dst];
  for (let u = prev[dst]; u >= 0; u = prev[u]) { out.push(u); if (u === src) break; }
  return out[out.length - 1] === src ? out.reverse() : [];
}

/**
 * Percorso fra sistemi stellari (collegamenti logici via jump point, nessuna distanza
 * euclidea fra sistemi). links: [{from, to, ...}] direzionali. BFS: minimo numero di jump.
 */
export function systemsPath(links, from, to) {
  if (from === to) return [];
  const queue = [[from, []]];
  const seen = new Set([from]);
  while (queue.length) {
    const [s, path] = queue.shift();
    for (const l of links.filter((x) => x.from === s && x.usable)) {
      if (seen.has(l.to)) continue;
      const p = [...path, l];
      if (l.to === to) return p;
      seen.add(l.to); queue.push([l.to, p]);
    }
  }
  return null;
}
