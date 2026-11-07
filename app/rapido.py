"""Agenda · «Añadir rápido»: de una frase a una tarea, en casa y sin IA.

  «Llamar al taller mañana 10:00 #coche !alta»   → vence mañana a las 10:00, etiqueta coche, prioridad alta
  «Regar la orquídea cada martes y viernes @casa» → repetición semanal MA y VI, en la lista Casa
Reconoce: hoy, mañana, pasado mañana, ayer, anteayer, lunes…domingo (el próximo), «el 15», 15/11, 15/11/2027, «15 de noviembre»,
«en 3 días», «la semana que viene»; horas 10:00, 10h, «a las 10», «a las 6 de la tarde»; #etiqueta, !alta/!media/!baja
(o !!! / !! / !), @lista; «cada día», «cada semana», «cada mes», «cada año», «cada lunes y jueves», «cada 2 semanas».
Lo que no entiende se queda en el título.
"""
from __future__ import annotations

import datetime as dt
import re
import unicodedata

DIAS = {"lunes": 0, "martes": 1, "miercoles": 2, "jueves": 3, "viernes": 4, "sabado": 5, "domingo": 6}
ICAL_DIA = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"]
MESES = {m: i + 1 for i, m in enumerate(["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
                                          "septiembre", "octubre", "noviembre", "diciembre"])}
MESES["setiembre"] = 9


def _sin_tildes(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def interpretar(frase: str, hoy: dt.date | None = None, listas: list[dict] | None = None) -> dict:
    hoy = hoy or dt.date.today()
    texto = " " + frase.strip() + " "
    out: dict = {"etiquetas": []}

    def quitar(m):
        nonlocal texto
        texto = texto[:m.start()] + " " + texto[m.end():]

    # etiquetas, prioridad y lista
    for m in list(re.finditer(r"(?<!\S)#([\wáéíóúñü-]+)", texto, re.I))[::-1]:
        out["etiquetas"].insert(0, m.group(1).lower())
        quitar(m)
    m = re.search(r"(?<!\S)!(alta|media|baja|!{0,2})(?!\S)", texto, re.I)
    if m:
        v = m.group(1).lower()
        out["prioridad"] = {"!!": "alta", "!": "media", "": "baja"}.get(v, v)
        quitar(m)
    m = re.search(r"(?<!\S)@([\wáéíóúñü-]+)", texto, re.I)
    if m and listas:
        buscada = _sin_tildes(m.group(1).lower())
        for l in listas:
            if _sin_tildes(l["nombre"].lower()).startswith(buscada):
                out["lista"] = l["id"]
                quitar(m)
                break

    low = _sin_tildes(texto.lower())

    # repetición
    m = re.search(r"\bcada (\d+ )?(dia|dias|semana|semanas|mes|meses|ano|anos)\b", low)
    if m:
        frec = {"dia": "DAILY", "semana": "WEEKLY", "mes": "MONTHLY", "ano": "YEARLY"}[m.group(2).rstrip("s").replace("dia", "dia")
                                                                                       if m.group(2) != "meses" else "mes"]
        regla = f"FREQ={frec}" + (f";INTERVAL={int(m.group(1))}" if m.group(1) and int(m.group(1)) > 1 else "")
        out["repeticion"] = regla
        texto = texto[:m.start()] + " " + texto[m.end():]
        low = low[:m.start()] + " " + low[m.end():]
    m = re.search(r"\bcada ((?:(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo)(?:,? y |, | )?)+)", low)
    if m and "repeticion" not in out:
        dias = [d for d in DIAS if re.search(rf"\b{d}\b", m.group(1))]
        out["repeticion"] = "FREQ=WEEKLY;BYDAY=" + ",".join(ICAL_DIA[DIAS[d]] for d in dias)
        texto = texto[:m.start()] + " " + texto[m.end():]
        low = low[:m.start()] + " " + low[m.end():]
        if "vence" not in out:
            prox = min(((DIAS[d] - hoy.weekday()) % 7) for d in dias)
            out["vence"] = (hoy + dt.timedelta(days=prox)).isoformat()

    # fecha
    fecha = None
    patrones = [
        (r"\banteayer\b", lambda m: hoy - dt.timedelta(days=2)),
        (r"\bayer\b", lambda m: hoy - dt.timedelta(days=1)),
        (r"\bpasado manana\b", lambda m: hoy + dt.timedelta(days=2)),
        (r"\bmanana\b", lambda m: hoy + dt.timedelta(days=1)),
        (r"\bhoy\b", lambda m: hoy),
        (r"\ben (\d+) dias?\b", lambda m: hoy + dt.timedelta(days=int(m.group(1)))),
        (r"\b(?:la )?semana que viene\b|\bla proxima semana\b", lambda m: hoy + dt.timedelta(days=7 - hoy.weekday())),
        (r"\b(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?\b", lambda m: _dmy(int(m.group(1)), int(m.group(2)), m.group(3), hoy)),
        (r"\b(?:el )?(\d{1,2}) de (" + "|".join(MESES) + r")(?: de (\d{4}))?\b",
         lambda m: _dmy(int(m.group(1)), MESES[m.group(2)], m.group(3), hoy)),
        (r"\b(?:el |este |el proximo |el que viene )?(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b",
         lambda m: hoy + dt.timedelta(days=((DIAS[m.group(1)] - hoy.weekday()) % 7) or 7)),
        (r"\bel (\d{1,2})\b", lambda m: _dia_mes(int(m.group(1)), hoy)),
    ]
    for patron, f in patrones:
        m = re.search(patron, low)
        if m:
            try:
                fecha = f(m)
            except ValueError:
                fecha = None
            if fecha:
                texto = texto[:m.start()] + " " + texto[m.end():]
                low = low[:m.start()] + " " + low[m.end():]
                break

    # hora
    hora = None
    m = re.search(r"\b(?:a las? )?(\d{1,2})[:.](\d{2})\s*h?\b", low) or re.search(r"\b(\d{1,2})\s*h\b", low) \
        or re.search(r"\ba las? (\d{1,2})(?: y (media|cuarto))?(?: de la (manana|tarde|noche))?\b", low)
    if m:
        h = int(m.group(1))
        mi = int(m.group(2)) if m.lastindex and m.lastindex >= 2 and m.group(2) and m.group(2).isdigit() else 0
        if m.lastindex and m.lastindex >= 2 and m.group(2) in ("media", "cuarto"):
            mi = 30 if m.group(2) == "media" else 15
        if m.lastindex and m.lastindex >= 3 and m.group(3) in ("tarde", "noche") and h < 12:
            h += 12
        if h < 24 and mi < 60:
            hora = dt.time(h, mi)
            texto = texto[:m.start()] + " " + texto[m.end():]

    if fecha or hora:
        f = fecha or (out.get("vence") and dt.date.fromisoformat(out["vence"])) or hoy
        if hora:
            out["vence"] = dt.datetime.combine(f, hora).isoformat()
            out["con_hora"] = True
        else:
            out["vence"] = f.isoformat()
            out["con_hora"] = False
    elif "vence" in out:
        out["con_hora"] = False

    out["titulo"] = re.sub(r"\s{2,}", " ", texto).strip(" ,.-") or frase.strip()
    if not out["etiquetas"]:
        out.pop("etiquetas")
    return out


def _dmy(d: int, m: int, y: str | None, hoy: dt.date) -> dt.date:
    if y:
        a = int(y) + (2000 if len(y) == 2 else 0)
        return dt.date(a, m, d)
    f = dt.date(hoy.year, m, d)
    return f if f >= hoy else dt.date(hoy.year + 1, m, d)


def _dia_mes(d: int, hoy: dt.date) -> dt.date:
    if not 1 <= d <= 31:
        raise ValueError
    try:
        f = dt.date(hoy.year, hoy.month, d)
    except ValueError:
        f = None
    if f and f >= hoy:
        return f
    m, a = (hoy.month % 12) + 1, hoy.year + (hoy.month == 12)
    return dt.date(a, m, d)


def selftest() -> int:
    hoy = dt.date(2026, 11, 6)            # viernes
    L = [{"id": "casa", "nombre": "Casa"}, {"id": "compra", "nombre": "Compra"}]
    casos = [
        ("Llamar al taller mañana 10:00 #coche !alta", {"titulo": "Llamar al taller", "vence": "2026-11-07T10:00:00", "etiquetas": ["coche"], "prioridad": "alta"}),
        ("Regar la orquídea cada martes y viernes @casa", {"titulo": "Regar la orquídea", "repeticion": "FREQ=WEEKLY;BYDAY=TU,FR", "lista": "casa", "vence": "2026-11-06"}),
        ("Leche y pan @compra", {"titulo": "Leche y pan", "lista": "compra"}),
        ("Médico el martes a las 6 de la tarde", {"titulo": "Médico", "vence": "2026-11-10T18:00:00"}),
        ("Pagar la comunidad el 15 #casa", {"titulo": "Pagar la comunidad", "vence": "2026-11-15", "etiquetas": ["casa"]}),
        ("Renovar DNI 3/1/2027 !!!", {"titulo": "Renovar DNI", "vence": "2027-01-03", "prioridad": "alta"}),
        ("Llamar a mamá !! hoy", {"titulo": "Llamar a mamá", "prioridad": "media", "vence": "2026-11-06"}),
        ("Revisar la caldera cada año el 20 de octubre", {"titulo": "Revisar la caldera", "repeticion": "FREQ=YEARLY", "vence": "2027-10-20"}),
        ("Comprar regalo en 3 días", {"titulo": "Comprar regalo", "vence": "2026-11-09"}),
        ("Tomar la pastilla cada día 9h", {"titulo": "Tomar la pastilla", "repeticion": "FREQ=DAILY", "vence": "2026-11-06T09:00:00"}),
        ("Renovar el seguro ayer #coche", {"titulo": "Renovar el seguro", "vence": "2026-11-05"}),
        ("Sin fecha ni nada", {"titulo": "Sin fecha ni nada"}),
    ]
    mal = 0
    for frase, esp in casos:
        r = interpretar(frase, hoy, L)
        ok = all(r.get(k) == v for k, v in esp.items())
        print(("  OK   " if ok else "  FALLO ") + frase + ("" if ok else f" → {r}"))
        mal += not ok
    print("TODO OK" if not mal else f"FALLOS: {mal}")
    return 1 if mal else 0


if __name__ == "__main__":
    raise SystemExit(selftest())
