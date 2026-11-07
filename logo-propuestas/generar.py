"""Propuestas de logo para Agenda (#275, 2026-11-07) con el estilo de la familia de portales.

Fondo #160f30 con rx 224 sobre 1024, figura plana en dos tonos (claro a la izquierda, oscuro recortado a la
derecha) y detalles recortados en el color del fondo. Se evitan los colores y dibujos de los vecinos: violeta con
lista (Ticketing), azul con calendario (Semana), verde con gráfico (Finanzas).
"""
import base64
from pathlib import Path

AQUI = Path(__file__).parent
RAIZ = AQUI.parent.parent
FONDO = "#160f30"


def icono(cuerpo: str, defs: str = "") -> str:
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">\n'
            f' <rect width="1024" height="1024" rx="224" fill="{FONDO}"/>\n'
            f'<defs>{defs}</defs>\n{cuerpo}\n</svg>\n')


def mitad(clip_id: str, color: str, x: int = 512) -> str:
    return f'<rect x="{x}" y="0" width="{1024 - x}" height="1024" fill="{color}" clip-path="url(#{clip_id})"/>'


P = {}

# 1 · Hecho: una casilla grande con su marca, la idea de «tarea cumplida» (sigue el verde de la Agenda actual).
caja = "M300 220 H724 A80 80 0 0 1 804 300 V724 A80 80 0 0 1 724 804 H300 A80 80 0 0 1 220 724 V300 A80 80 0 0 1 300 220 Z"
P["1-hecho"] = icono(
    f'<path d="{caja}" fill="#6fdca0"/>\n{mitad("k", "#34b277")}\n'
    f'<path d="M352 524 L466 638 L684 396" fill="none" stroke="{FONDO}" stroke-width="84" stroke-linecap="round" stroke-linejoin="round"/>',
    f'<clipPath id="k"><path d="{caja}"/></clipPath>')

# 2 · Recordatorio: una campana (el aviso del iPhone) con una marca recortada.
campana = ("M512 196 C620 196 708 284 708 392 V560 L780 668 A26 26 0 0 1 758 708 H266 A26 26 0 0 1 244 668 "
           "L316 560 V392 C316 284 404 196 512 196 Z")
P["2-recordatorio"] = icono(
    f'<circle cx="512" cy="176" r="46" fill="#ff9e80"/>\n<path d="{campana}" fill="#ff9e80"/>\n{mitad("c", "#e8674a")}\n'
    f'<path d="M432 790 A80 80 0 0 0 592 790 Z" fill="#e8674a"/>\n'
    f'<path d="M408 470 L486 548 L630 404" fill="none" stroke="{FONDO}" stroke-width="64" stroke-linecap="round" stroke-linejoin="round"/>',
    f'<clipPath id="c"><path d="{campana}"/></clipPath>')

# 3 · La libreta: una agenda de papel con anillas y cinta de marcapáginas.
tapa = "M290 170 H740 A60 60 0 0 1 800 230 V794 A60 60 0 0 1 740 854 H290 A60 60 0 0 1 230 794 V230 A60 60 0 0 1 290 170 Z"
anillas = "".join(f'<rect x="186" y="{y}" width="110" height="44" rx="22" fill="#f2c9cf"/>' for y in (290, 470, 650))
P["3-libreta"] = icono(
    f'<path d="{tapa}" fill="#f47a8c"/>\n{mitad("t", "#d64a63")}\n{anillas}\n'
    f'<path d="M600 170 H690 V420 L645 384 L600 420 Z" fill="#f7c533"/>\n'
    f'<g fill="{FONDO}"><rect x="350" y="520" width="340" height="44" rx="22"/><rect x="350" y="620" width="260" height="44" rx="22"/></g>',
    f'<clipPath id="t"><path d="{tapa}"/></clipPath>')

# 4 · A tiempo: un reloj con una marca en lugar de agujas (tareas con hora y aviso).
P["4-a-tiempo"] = icono(
    f'<circle cx="512" cy="530" r="320" fill="#f48fb1"/>\n{mitad("r", "#d9578a")}\n'
    f'<g fill="#f48fb1"><rect x="300" y="150" width="130" height="64" rx="32" transform="rotate(-30 365 182)"/>'
    f'<rect x="594" y="150" width="130" height="64" rx="32" transform="rotate(30 659 182)"/></g>\n'
    f'<circle cx="512" cy="530" r="236" fill="{FONDO}"/>\n'
    f'<path d="M412 536 L486 610 L630 450" fill="none" stroke="#f7c533" stroke-width="70" stroke-linecap="round" stroke-linejoin="round"/>',
    '<clipPath id="r"><circle cx="512" cy="530" r="320"/></clipPath>')

# 5 · Hoja del día: la hoja arrancable de un calendario de pared con el número del día y una marca.
hoja = "M260 250 H764 A60 60 0 0 1 824 310 V790 A60 60 0 0 1 764 850 H260 A60 60 0 0 1 200 790 V310 A60 60 0 0 1 260 250 Z"
P["5-hoja-del-dia"] = icono(
    f'<path d="{hoja}" fill="#7ee0c8"/>\n{mitad("d", "#3fb39b")}\n'
    f'<rect x="200" y="250" width="624" height="150" fill="#3fb39b" clip-path="url(#d)"/>\n'
    f'<rect x="200" y="250" width="312" height="150" fill="#56c9b0" clip-path="url(#d)"/>\n'
    f'<g fill="#7ee0c8"><circle cx="350" cy="250" r="44"/><circle cx="674" cy="250" r="44"/></g>\n'
    f'<g fill="{FONDO}"><circle cx="350" cy="250" r="18"/><circle cx="674" cy="250" r="18"/></g>\n'
    f'<path d="M372 620 L476 724 L660 512" fill="none" stroke="{FONDO}" stroke-width="76" stroke-linecap="round" stroke-linejoin="round"/>',
    f'<clipPath id="d"><path d="{hoja}"/></clipPath>')

for nombre, svg in P.items():
    (AQUI / f"{nombre}.svg").write_text(svg)


def img(svg: str) -> str:
    return "data:image/svg+xml;base64," + base64.b64encode(svg.encode()).decode()


NOMBRES = {"1-hecho": "Hecho", "2-recordatorio": "Recordatorio", "3-libreta": "Libreta", "4-a-tiempo": "A tiempo",
           "5-hoja-del-dia": "Hoja del día"}
vecinos = {"Agenda (actual)": RAIZ / "homelab-ai-agenda/app/static/favicon.svg", "Semana": RAIZ / "homelab-ai-semana/app/static/favicon.svg",
           "Ticketing": RAIZ / "homelab-ai-tasks/app/static/favicon.svg", "Escudo": RAIZ / "homelab-ai-escudo/app/static/favicon.svg",
           "Energía": RAIZ / "homelab-ai-power/app/static/favicon.svg", "Finanzas": RAIZ / "logo/portal-finanzas.svg"}
celdas = "".join(f'<figure><img src="{img(s)}" alt=""><figcaption>{n[0]} · {NOMBRES[n]}</figcaption></figure>' for n, s in P.items())
fila = "".join(f'<figure><img src="{img(p.read_text())}" alt=""><figcaption>{n}</figcaption></figure>' for n, p in vecinos.items())
(AQUI / "index.html").write_text(f'''<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Logos Agenda</title>
<style>body{{font:15px -apple-system,sans-serif;margin:16px;background:#000;color:#fff}}
.g{{display:grid;grid-template-columns:repeat(3,1fr);gap:22px 10px;max-width:420px;background:#1c1c1e;border-radius:34px;padding:26px 18px}}
figure{{margin:0;text-align:center}}img{{width:96px;height:96px;border-radius:22px}}figcaption{{margin-top:6px;font-size:13px;font-weight:600}}
h2{{font-size:15px;color:#aaa;font-weight:500;margin:22px 0 10px}}</style></head><body>
<h2>Propuestas para Agenda</h2><div class="g">{celdas}</div>
<h2>Sus vecinos en la carpeta</h2><div class="g">{fila}</div></body></html>''')
print("hecho:", ", ".join(P))
