// Lettura e scrittura di file Excel .xlsx SENZA librerie esterne (nessuna CDN, nessuna
// dipendenza con vulnerabilita' note). Un .xlsx e' un archivio ZIP di file XML:
//  - lettura: directory centrale ZIP, decompressione "deflate" con DecompressionStream del browser,
//    workbook.xml + relazioni per i fogli, sharedStrings.xml, styles.xml per riconoscere le date;
//  - scrittura: ZIP senza compressione (metodo "store", accettato da Excel e LibreOffice) con un
//    unico foglio, stringhe inline e numeri.
// Supporta cio' che serve a NAVCOM: celle testo, numero, booleano, data, formula (valore in cache).

const td = new TextDecoder('utf-8');
const te = new TextEncoder();

// ---------------------------------------------------------------- ZIP
function u16(b, o) { return b[o] | (b[o + 1] << 8); }
function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('Questo browser non sa decomprimere i file Excel (DecompressionStream assente): aggiornalo.');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Elenco dei file nell'archivio: Map nome -> funzione asincrona che restituisce i byte. */
export function readZip(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (u32(b, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Il file non è un archivio .xlsx valido (struttura ZIP non trovata).');
  const count = u16(b, eocd + 10);
  let p = u32(b, eocd + 16);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (u32(b, p) !== 0x02014b50) throw new Error('Archivio .xlsx danneggiato (directory centrale).');
    const method = u16(b, p + 10), csize = u32(b, p + 20), nlen = u16(b, p + 28), xlen = u16(b, p + 30), clen = u16(b, p + 32);
    const local = u32(b, p + 42);
    const name = td.decode(b.subarray(p + 46, p + 46 + nlen));
    files.set(name, async () => {
      const start = local + 30 + u16(b, local + 26) + u16(b, local + 28);
      const data = b.subarray(start, start + csize);
      if (method === 0) return data;
      if (method === 8) return inflateRaw(data);
      throw new Error(`Compressione ZIP non supportata (metodo ${method}).`);
    });
    p += 46 + nlen + xlen + clen;
  }
  return files;
}

const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(data) { let c = 0xffffffff; for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

/** ZIP senza compressione. files: [[nome, Uint8Array|string]] */
export function writeZip(files) {
  const parts = [], central = [];
  let offset = 0;
  const w16 = (a, o, v) => { a[o] = v & 0xff; a[o + 1] = (v >>> 8) & 0xff; };
  const w32 = (a, o, v) => { a[o] = v & 0xff; a[o + 1] = (v >>> 8) & 0xff; a[o + 2] = (v >>> 16) & 0xff; a[o + 3] = (v >>> 24) & 0xff; };
  for (const [name, content] of files) {
    const data = typeof content === 'string' ? te.encode(content) : content;
    const nb = te.encode(name);
    const crc = crc32(data);
    const lh = new Uint8Array(30 + nb.length);
    w32(lh, 0, 0x04034b50); w16(lh, 4, 20); w16(lh, 6, 0x0800); w16(lh, 8, 0); w16(lh, 10, 0); w16(lh, 12, 0x21);
    w32(lh, 14, crc); w32(lh, 18, data.length); w32(lh, 22, data.length); w16(lh, 26, nb.length); w16(lh, 28, 0); lh.set(nb, 30);
    const ch = new Uint8Array(46 + nb.length);
    w32(ch, 0, 0x02014b50); w16(ch, 4, 20); w16(ch, 6, 20); w16(ch, 8, 0x0800); w16(ch, 10, 0); w16(ch, 12, 0); w16(ch, 14, 0x21);
    w32(ch, 16, crc); w32(ch, 20, data.length); w32(ch, 24, data.length); w16(ch, 28, nb.length); w16(ch, 30, 0); w16(ch, 32, 0);
    w16(ch, 34, 0); w16(ch, 36, 0); w32(ch, 38, 0); w32(ch, 42, offset); ch.set(nb, 46);
    parts.push(lh, data); central.push(ch);
    offset += lh.length + data.length;
  }
  const csize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  w32(end, 0, 0x06054b50); w16(end, 8, files.length); w16(end, 10, files.length); w32(end, 12, csize); w32(end, 16, offset);
  const out = new Uint8Array(offset + csize + 22);
  let p = 0;
  for (const part of [...parts, ...central, end]) { out.set(part, p); p += part.length; }
  return out;
}

// ---------------------------------------------------------------- XML minimo
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function xmlDecode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) => (e[0] === '#'
    ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e.toLowerCase()]))
    .replace(/_x([0-9A-F]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}
const xmlEsc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  // caratteri di controllo non ammessi in XML
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const attr = (tag, name) => { const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag); return m ? xmlDecode(m[1]) : null; };
/** Testo di tutti i <t> contenuti (stringhe con formattazione "rich text" incluse, fonetica esclusa). */
const allText = (xml) => { let out = ''; const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, ''); for (const m of clean.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += xmlDecode(m[1]); return out; };

// ---------------------------------------------------------------- date Excel
const DATE_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);
function isDateFormat(code) {
  const c = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
  return /[dmyhs]/i.test(c) && !/^[#0.,%\s]*$/.test(c);
}
/** Numero seriale Excel (sistema 1900) -> data ISO. */
export function excelSerialToISO(v) {
  const ms = Math.round((v - 25569) * 86400000);
  return new Date(ms).toISOString().replace(/\.000Z$/, 'Z');
}
export function isoToExcelSerial(iso) { return Date.parse(iso) / 86400000 + 25569; }

// ---------------------------------------------------------------- lettura
const colIndex = (ref) => { let n = 0; for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
const resolve = (base, target) => (target.startsWith('/') ? target.slice(1) : `${base}${target}`).replace(/[^/]+\/\.\.\//g, '');

/**
 * Legge un .xlsx. Restituisce {sheets:[{name, rows:any[][]}]}: celle stringa, numero, booleano,
 * date come stringa ISO, celle vuote come null.
 */
export async function readXlsx(buf) {
  const zip = readZip(buf);
  // Alcuni generatori (OpenXML SDK, .NET) scrivono gli elementi con prefisso di namespace (<x:row>, <x:c>...):
  // il prefisso viene tolto dai nomi degli elementi (gli attributi come r:id restano invariati).
  const text = async (name) => { const f = zip.get(name); return f ? td.decode(await f()).replace(/<(\/?)[A-Za-z_][\w.-]*:(?=[A-Za-z_])/g, '<$1') : null; };
  const wb = await text('xl/workbook.xml');
  if (!wb) throw new Error('Il file non sembra un documento Excel .xlsx (manca xl/workbook.xml). I vecchi .xls non sono supportati: salvalo come .xlsx.');
  const rels = (await text('xl/_rels/workbook.xml.rels')) ?? '';
  const relMap = new Map([...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [attr(m[0], 'Id'), attr(m[0], 'Target')]));
  const ssXml = await text('xl/sharedStrings.xml');
  const shared = ssXml ? [...ssXml.matchAll(/<si\b[^>]*?\/>|<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => (m[1] ? allText(m[1]) : '')) : [];
  const stylesXml = (await text('xl/styles.xml')) ?? '';
  const custom = new Map([...stylesXml.matchAll(/<numFmt\b[^>]*>/g)].map((m) => [+attr(m[0], 'numFmtId'), attr(m[0], 'formatCode') ?? '']));
  const xfsBlock = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? '';
  const xfDate = [...xfsBlock.matchAll(/<xf\b[^>]*\/?>/g)].map((m) => { const id = +(attr(m[0], 'numFmtId') ?? 0); return DATE_IDS.has(id) || (custom.has(id) && isDateFormat(custom.get(id))); });
  const date1904 = /date1904="(1|true)"/.test(wb);
  const sheets = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const name = attr(m[0], 'name');
    const rid = attr(m[0], 'r:id') ?? attr(m[0], 'id');
    const target = relMap.get(rid);
    if (!target) continue;
    const xml = await text(resolve('xl/', target));
    if (!xml) continue;
    const rows = [];
    for (const r of xml.matchAll(/<row\b([^>]*?)\/>|<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      const rowNo = +(attr(` ${r[1] ?? r[2]}`, 'r') ?? rows.length + 1) - 1;
      const cells = [];
      let next = 0;
      for (const c of (r[3] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const a = ` ${c[1]}`;
        const ref = attr(a, 'r');
        const ci = ref ? colIndex(ref) : next;
        next = ci + 1;
        const t = attr(a, 't') ?? 'n';
        const s = +(attr(a, 's') ?? 0);
        const body = c[2] ?? '';
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        let val = null;
        if (t === 's') val = v !== undefined ? shared[+v] ?? '' : null;
        else if (t === 'inlineStr') val = allText(body);
        else if (t === 'str') val = v !== undefined ? xmlDecode(v) : null;
        else if (t === 'b') val = v === '1';
        else if (t === 'e') val = v !== undefined ? xmlDecode(v) : null;
        else if (v !== undefined && v !== '') {
          const num = Number(v);
          val = xfDate[s] ? excelSerialToISO(num + (date1904 ? 1462 : 0)) : num;
        }
        cells[ci] = val;
      }
      for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = null;
      rows[rowNo] = cells;
    }
    for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    sheets.push({ name, rows });
  }
  if (!sheets.length) throw new Error('Nessun foglio leggibile nel file.');
  return { sheets };
}

// ---------------------------------------------------------------- scrittura
const colName = (i) => { let s = ''; for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };

/**
 * Scrive un .xlsx con un foglio. rows: array di righe (stringhe, numeri, booleani, null).
 * Le stringhe sono scritte come testo: Excel non le reinterpreta (niente date o numeri inventati).
 */
export function writeXlsx(rows, sheetName = 'Punti') {
  const safeName = xmlEsc(String(sheetName).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Foglio1');
  const body = rows.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => {
    if (v === null || v === undefined || v === '') return '';
    const ref = `${colName(c)}${r + 1}`;
    if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`;
    if (typeof v === 'boolean') return `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${r === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
  }).join('')}</row>`).join('');
  const files = [
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${safeName}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ['xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'],
    ['xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${body}</sheetData></worksheet>`],
  ];
  return writeZip(files);
}
