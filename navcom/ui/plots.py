"""Grafici Plotly 2D/3D del sistema e delle rotte. Assi in Gm."""
from __future__ import annotations

import math

import plotly.graph_objects as go

from ..core.qt import Body, NavPoint
from ..core.vector import Vec3

GM = 1e9
BG = "#05090f"
GRID = "#14304a"
CYAN = "#3fd0ff"
AMBER = "#ffb347"
GREEN = "#5dff9d"
RED = "#ff5f6d"
DIM = "#5b7a99"


def _g(v: Vec3) -> tuple[float, float, float]:
    return v.x / GM, v.y / GM, v.z / GM


def system_figure(points: list[NavPoint], bodies: tuple[Body, ...] = (), *,
                  segments: list[tuple[Vec3, Vec3, str, str]] = (),
                  marks: list[tuple[Vec3, str, str, str]] = (),
                  rings_m: list[tuple[float, str]] = (),
                  mode: str = "2D", height: int = 620) -> go.Figure:
    """segments: (a, b, etichetta, colore); marks: (pos, etichetta, colore, simbolo)."""
    fig = go.Figure()
    three = mode == "3D"
    sc = go.Scatter3d if three else go.Scatter

    def add(xs, ys, zs, **kw):
        if three:
            fig.add_trace(sc(x=xs, y=ys, z=zs, **kw))
        else:
            field = "%{hovertext}" if "hovertext" in kw else "%{text}"
            kw.pop("hovertemplate", None)
            fig.add_trace(sc(x=xs, y=ys, **kw,
                             hovertemplate=field + "<br>x %{x:.4f} Gm<br>y %{y:.4f} Gm<extra></extra>"))

    if points:
        xs, ys, zs = zip(*(_g(p.pos) for p in points))
        add(xs, ys, zs, mode="markers", name="Marker / punti",
            text=[p.name for p in points],
            marker=dict(size=3 if three else 5, color=[CYAN if p.qt_valid else DIM for p in points], opacity=0.7),
            hovertemplate="%{text}<extra></extra>")
    real_bodies = [b for b in bodies if not b.uncertain]
    if real_bodies:
        xs, ys, zs = zip(*(_g(b.center) for b in real_bodies))
        # etichette solo per stella e pianeti (raggio >= 700 km): le lune si sovrapporrebbero
        add(xs, ys, zs, mode="markers+text", name="Corpi celesti",
            text=[b.name if b.radius_m >= 7e5 else "" for b in real_bodies],
            hovertext=[b.name for b in real_bodies], textposition="top center",
            textfont=dict(color=DIM, size=10),
            marker=dict(size=[max(6, min(18, math.log10(max(b.radius_m, 1)) * 2)) for b in real_bodies],
                        color="#2a4766", line=dict(color=CYAN, width=1)),
            hovertemplate="%{hovertext}<extra></extra>")
    for r, label in rings_m:
        th = [i * 2 * math.pi / 360 for i in range(361)]
        add([r / GM * math.cos(t) for t in th], [r / GM * math.sin(t) for t in th], [0] * len(th),
            mode="lines", name=label, line=dict(color=AMBER, width=1, dash="dot"),
            text=[label] * len(th), hovertemplate="%{text}<extra></extra>")
    for a, b, label, color in segments:
        (x0, y0, z0), (x1, y1, z1) = _g(a), _g(b)
        add([x0, x1], [y0, y1], [z0, z1], mode="lines", name=label,
            line=dict(color=color, width=4 if three else 2), text=[label, label],
            hovertemplate="%{text}<extra></extra>")
    for pos, label, color, symbol in marks:
        x, y, z = _g(pos)
        add([x], [y], [z], mode="markers+text", name=label, text=[label], textposition="bottom center",
            textfont=dict(color=color, size=12),
            marker=dict(size=7 if three else 12, color=color, symbol=symbol if not three else "diamond"),
            hovertemplate="%{text}<extra></extra>")

    layout = dict(paper_bgcolor=BG, plot_bgcolor=BG, height=height, margin=dict(l=10, r=10, t=30, b=10),
                  font=dict(color="#cfe8ff", family="Consolas, monospace"),
                  legend=dict(bgcolor="rgba(5,9,15,0.7)", font=dict(size=10)))
    if three:
        axis = dict(backgroundcolor=BG, gridcolor=GRID, zerolinecolor=GRID, color=DIM)
        fig.update_layout(**layout, scene=dict(xaxis=dict(title="x (Gm)", **axis), yaxis=dict(title="y (Gm)", **axis),
                                               zaxis=dict(title="z (Gm)", **axis), aspectmode="data"))
    else:
        fig.update_layout(**layout)
        fig.update_xaxes(title="x (Gm)", gridcolor=GRID, zerolinecolor=GRID, color=DIM)
        fig.update_yaxes(title="y (Gm)", gridcolor=GRID, zerolinecolor=GRID, color=DIM,
                         scaleanchor="x", scaleratio=1)
    return fig
