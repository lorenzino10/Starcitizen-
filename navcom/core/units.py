"""Formattazione delle distanze. Unita' interna: metro."""
from __future__ import annotations

KM = 1_000.0
MM = 1_000_000.0          # megametro
GM = 1_000_000_000.0      # gigametro


def _group(n: int) -> str:
    # separatore delle migliaia all'italiana
    return f"{n:,}".replace(",", ".")


def fmt_km(m: float) -> str:
    """Distanza esatta in km, arrotondata al km (es. '14.290.792 km')."""
    return f"{_group(round(m / KM))} km"


def fmt_auto(m: float) -> str:
    """Forma compatta leggibile (km sotto 1 Mm, poi Mm, poi Gm)."""
    a = abs(m)
    if a < MM:
        return f"{m / KM:,.1f} km".replace(",", "X").replace(".", ",").replace("X", ".")
    if a < GM:
        return f"{m / MM:.2f} Mm".replace(".", ",")
    return f"{m / GM:.3f} Gm".replace(".", ",")


def hud_reading(m: float, decimals: int = 1) -> str:
    """Valore come potrebbe apparire nell'HUD durante il QT, in Gm/Mm/km.

    ATTENZIONE: il numero di decimali mostrato dall'HUD del gioco va
    confermato in gioco (impostazione `decimals`). Questa funzione arrotonda e
    basta: la precisione reale e' limitata dalla risoluzione dell'HUD e dal
    tempo di reazione del pilota, che NON vengono stimati qui.
    """
    a = abs(m)
    if a >= GM:
        unit, div = "Gm", GM
    elif a >= MM:
        unit, div = "Mm", MM
    else:
        unit, div = "km", KM
    return f"{m / div:.{decimals}f} {unit}"


def hud_resolution_m(m: float, decimals: int = 1) -> float:
    """Ampiezza (m) di un passo dell'ultima cifra HUD per una distanza m."""
    a = abs(m)
    div = GM if a >= GM else MM if a >= MM else KM
    return div / (10 ** decimals)
