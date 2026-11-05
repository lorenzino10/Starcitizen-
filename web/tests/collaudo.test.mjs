// Test di NAVIGABILITA' che richiedono una prova in gioco: non si possono automatizzare
// (NAVCOM non legge il gioco). Restano "todo" finche' non sono confermati; il protocollo
// e' in docs/COLLAUDO_IN_GIOCO.md. Tenuti separati dai test matematici (plan.test.mjs).
import { test } from 'node:test';

const TODO = [
  'HUD QT: unità e decimali sotto 1 Gm (Mm? km?) e soglie di cambio unità',
  'HUD QT: regola di arrotondamento (troncamento, arrotondamento, per eccesso)',
  'Uscita manuale dal QT: tasto e ritardo fra pressione e uscita effettiva',
  'Tempo di reazione personale (latenza e aggiornamento HUD inclusi)',
  'Salto QT avviato da spazio profondo dopo un\'interruzione',
  '/showlocation in 4.10: formato e frame (stesso di CitizenHQ?)',
  'Distanza minima di un salto QT',
  'Parametri del proprio quantum drive (Vmax, Ve, a1, a2, preparazione)',
  'Raggio di ostruzione reale dei corpi celesti rispetto al margine impostato',
  'Posizione dell\'ingresso dei jump point rispetto alle stazioni Gateway',
];
for (const t of TODO) test(`[collaudo in gioco] ${t}`, { todo: 'da verificare in gioco' }, () => {});
