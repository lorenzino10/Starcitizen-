// Caricamento della libreria grafica locale: diagnosi degli errori e assenza di CDN esterne.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { ensurePlotly, PLOTLY_URL, PLOTLY_VERSION, MESSAGES, _reset } from '../js/plotly-loader.js';

const WEB = new URL('../', import.meta.url);

/** finto document: onScript decide cosa succede allo <script> iniettato */
function fakeEnv(onScript, fetchImpl) {
  const win = {};
  const doc = {
    createElement: () => ({}),
    head: { appendChild: (s) => setTimeout(() => onScript(s, win), 0) },
  };
  return { doc, win, fetchImpl };
}

test('Plotly caricata correttamente', async () => {
  _reset();
  const env = fakeEnv((s, win) => { win.Plotly = { react() {} }; s.onload(); }, async () => assert.fail('nessuna diagnosi attesa'));
  const r = await ensurePlotly(env);
  assert.equal(r.ok, true);
  assert.equal(typeof r.Plotly.react, 'function');
});

test('file assente sul sito (404) -> missing', async () => {
  _reset();
  const r = await ensurePlotly(fakeEnv((s) => s.onerror(), async () => ({ status: 404, ok: false })));
  assert.deepEqual([r.ok, r.reason], [false, 'missing']);
  assert.match(r.message, /mancante/);
});

test('rete assente (fetch lancia) -> network', async () => {
  _reset();
  const r = await ensurePlotly(fakeEnv((s) => s.onerror(), async () => { throw new TypeError('Failed to fetch'); }));
  assert.deepEqual([r.ok, r.reason], [false, 'network']);
  assert.match(r.message, /connessione/);
});

test('errore server (503) -> network', async () => {
  _reset();
  const r = await ensurePlotly(fakeEnv((s) => s.onerror(), async () => ({ status: 503, ok: false })));
  assert.equal(r.reason, 'network');
});

test('script caricato ma Plotly assente -> invalid; dopo un errore si puo\' riprovare', async () => {
  _reset();
  const r = await ensurePlotly(fakeEnv((s) => s.onload(), async () => ({ status: 200, ok: true })));
  assert.equal(r.reason, 'invalid');
  assert.equal(r.message, MESSAGES.invalid);
  const again = await ensurePlotly(fakeEnv((s, win) => { win.Plotly = { react() {} }; s.onload(); }));
  assert.equal(again.ok, true);
});

test('la libreria e\' nel repository nella versione dichiarata', () => {
  const file = new URL(PLOTLY_URL, WEB);
  assert.ok(statSync(file).size > 1_000_000);
  const head = readFileSync(file, 'utf8').slice(0, 400);
  assert.ok(head.includes(`v${PLOTLY_VERSION}`), head);
});

test('index.html non carica script da CDN esterne', () => {
  const html = readFileSync(new URL('index.html', WEB), 'utf8');
  const srcs = [...html.matchAll(/<script[^>]*\bsrc=["']([^"']+)/g)].map((m) => m[1]);
  assert.ok(srcs.length > 0);
  for (const s of srcs) assert.doesNotMatch(s, /^(https?:)?\/\//, s);
});

test('il workflow di pubblicazione copia web/vendor', () => {
  const yml = readFileSync(new URL('../.github/workflows/pages.yml', WEB), 'utf8');
  assert.match(yml, /web\/vendor/);
});

test('nome della cache offline uguale in app.js e sw.js', () => {
  const app = readFileSync(new URL('js/app.js', WEB), 'utf8').match(/CACHE_NAME = '([^']+)'/)[1];
  const sw = readFileSync(new URL('sw.js', WEB), 'utf8').match(/CACHE = '([^']+)'/)[1];
  assert.equal(app, sw);
});
