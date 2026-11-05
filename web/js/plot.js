// Mappa del sistema con Plotly (libreria locale in web/vendor, caricata da plotly-loader.js). Assi in Gm.
import { ensurePlotly } from './plotly-loader.js';
export const CYAN = '#3fd0ff', AMBER = '#ffb347', GREEN = '#5dff9d', RED = '#ff5f6d';
const BG = '#05090f', GRID = '#14304a', DIM = '#5b7a99';
const g = (v) => [v.x / 1e9, v.y / 1e9, v.z / 1e9];

/**
 * opts: {points, bodies, segments:[[a,b,label,color]], marks:[[pos,label,color,symbol]], rings:[[radius_m,label]], mode:'2D'|'3D'}
 */
export async function systemPlot(el, { points = [], bodies = [], segments = [], marks = [], rings = [], mode = '2D' }) {
  const lib = await ensurePlotly();
  if (!lib.ok) {
    el.innerHTML = `<p class="${lib.reason === 'network' ? 'warn' : 'err'}">Grafico non disponibile. ${lib.message}</p>`;
    el.style.height = 'auto';
    return;
  }
  el.style.height = '';
  const three = mode === '3D';
  const traces = [];
  const tr = (pts, extra) => {
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]), zs = pts.map((p) => p[2]);
    traces.push(three ? { type: 'scatter3d', x: xs, y: ys, z: zs, ...extra } : { type: 'scatter', x: xs, y: ys, ...extra });
  };
  if (points.length) {
    tr(points.map((p) => g(p.pos)), {
      mode: 'markers', name: 'Marker / punti', text: points.map((p) => p.name),
      hovertemplate: '%{text}<extra></extra>',
      marker: { size: three ? 3 : 5, opacity: 0.7, color: points.map((p) => (p.qtValid ? CYAN : DIM)) },
    });
  }
  const real = bodies.filter((b) => !b.uncertain);
  if (real.length) {
    tr(real.map((b) => g(b.center)), {
      mode: 'markers+text', name: 'Corpi celesti',
      text: real.map((b) => (b.radius >= 7e5 ? b.name : '')), hovertext: real.map((b) => b.name),
      hovertemplate: '%{hovertext}<extra></extra>', textposition: 'top center', textfont: { color: DIM, size: 10 },
      marker: { size: real.map((b) => Math.max(6, Math.min(18, Math.log10(Math.max(b.radius, 1)) * 2))), color: '#2a4766', line: { color: CYAN, width: 1 } },
    });
  }
  for (const [r, label] of rings) {
    const pts = Array.from({ length: 361 }, (_, i) => { const t = (i * Math.PI) / 180; return [(r / 1e9) * Math.cos(t), (r / 1e9) * Math.sin(t), 0]; });
    tr(pts, { mode: 'lines', name: label, hoverinfo: 'name', line: { color: AMBER, width: 1, dash: 'dot' } });
  }
  for (const [a, b, label, color, opt = {}] of segments) {
    tr([g(a), g(b)], { mode: 'lines', name: label, hoverinfo: 'name', showlegend: opt.legend ?? true,
      opacity: opt.opacity ?? 1, line: { color, width: opt.width ?? (three ? 5 : 2) } });
  }
  for (const [pos, label, color, symbol, textpos = 'bottom center'] of marks) {
    tr([g(pos)], { mode: 'markers+text', name: label, text: [label], textposition: textpos, textfont: { color, size: 12 },
      hovertemplate: `${label}<br>x %{x:.4f} Gm<br>y %{y:.4f} Gm<extra></extra>`,
      marker: { size: three ? 6 : 12, color, symbol: three ? 'diamond' : symbol } });
  }
  const axis = { gridcolor: GRID, zerolinecolor: GRID, color: DIM };
  const layout = {
    paper_bgcolor: BG, plot_bgcolor: BG, margin: { l: 40, r: 10, t: 20, b: 40 },
    font: { color: '#cfe8ff', family: 'Consolas, monospace' },
    legend: { bgcolor: 'rgba(5,9,15,0.7)', font: { size: 10 } },
  };
  if (three) {
    layout.scene = { aspectmode: 'manual', aspectratio: { x: 1, y: 1, z: 0.3 }, bgcolor: BG,
      camera: { eye: { x: 0.9, y: -1.3, z: 0.9 } },
      xaxis: { title: { text: 'x (Gm)' }, backgroundcolor: BG, ...axis }, yaxis: { title: { text: 'y (Gm)' }, backgroundcolor: BG, ...axis },
      zaxis: { title: { text: 'z (Gm)' }, backgroundcolor: BG, ...axis } };
  } else {
    layout.xaxis = { title: { text: 'x (Gm)' }, ...axis };
    layout.yaxis = { title: { text: 'y (Gm)' }, scaleanchor: 'x', scaleratio: 1, ...axis };
  }
  lib.Plotly.react(el, traces, layout, { responsive: true, displaylogo: false });
}
