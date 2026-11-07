"""Agenda · la parte que habla con Nextcloud (CalDAV).

Tareas = VTODO en las listas de tareas del usuario; eventos = VEVENT de sus calendarios. Se escribe con las
propiedades que entiende Recordatorios del iPhone:
  SUMMARY, DESCRIPTION, DUE (fecha o fecha y hora), DTSTART, PRIORITY (1 alta · 5 media · 9 baja), CATEGORIES,
  STATUS/COMPLETED, RELATED-TO (subtareas), RRULE (repetición) y VALARM con disparo ABSOLUTO (como hace el iPhone).
Una tarea que se repite, al completarla, salta a su siguiente fecha (no se marca hecha): igual que en Recordatorios.
"""
from __future__ import annotations

import datetime as dt
import os
import threading
import time
import uuid
from zoneinfo import ZoneInfo

import caldav
import caldav.elements.ical as dav_ical
from dateutil.rrule import rrulestr
from icalendar import Alarm, Calendar, Event, Todo, vRecur

TZ = ZoneInfo("Europe/Madrid")
URL = os.environ.get("AGENDA_NC_URL", "")      # p. ej. https://nextcloud.ejemplo/remote.php/dav
PRODID = "-//homelab-ai-agenda//Agenda//ES"


class SinNextcloud(RuntimeError):
    """Nextcloud no responde o rechaza la cuenta: el portal lo enseña y no deja guardar."""


class Nube:
    def __init__(self, usuario: str | None = None, clave: str | None = None):
        self.usuario = usuario or os.environ.get("AGENDA_NC_USER", "")
        self.clave = clave or os.environ.get("AGENDA_NC_PASSWORD", "")
        self._cal_cache: tuple[float, list] | None = None
        self._lock = threading.Lock()

    # ── conexión y calendarios ──
    def _cliente(self) -> caldav.DAVClient:
        if not URL or not self.usuario or not self.clave:
            raise SinNextcloud("falta la conexión con Nextcloud (AGENDA_NC_URL, AGENDA_NC_USER, AGENDA_NC_PASSWORD)")
        return caldav.DAVClient(url=URL, username=self.usuario, password=self.clave, timeout=20)

    def calendarios(self, fresco: bool = False) -> list:
        with self._lock:
            if not fresco and self._cal_cache and time.time() - self._cal_cache[0] < 60:
                return self._cal_cache[1]
            try:
                cals = self._cliente().principal().calendars()
                datos = []
                for c in cals:
                    try:
                        comps = c.get_supported_components()
                    except Exception:  # noqa: BLE001
                        comps = ["VEVENT"]
                    try:
                        color = c.get_property(dav_ical.CalendarColor()) or ""
                    except Exception:  # noqa: BLE001
                        color = ""
                    datos.append({"obj": c, "id": str(c.url).rstrip("/").split("/")[-1], "nombre": c.get_display_name(),
                                  "color": (color or "")[:7], "tareas": "VTODO" in comps, "eventos": "VEVENT" in comps,
                                  "propio": "_shared_by_" not in str(c.url)})
            except SinNextcloud:
                raise
            except Exception as e:  # noqa: BLE001
                raise SinNextcloud(f"Nextcloud no responde: {type(e).__name__}") from e
            self._cal_cache = (time.time(), datos)
            return datos

    def _cal(self, lista_id: str):
        for c in self.calendarios():
            if c["id"] == lista_id:
                return c
        raise KeyError(lista_id)

    # ── listas ──
    def listas(self) -> list[dict]:
        return [{k: c[k] for k in ("id", "nombre", "color")} for c in self.calendarios() if c["tareas"] and c["propio"]]

    def crear_lista(self, nombre: str, color: str = "") -> dict:
        p = self._cliente().principal()
        cal = p.make_calendar(name=nombre, supported_calendar_component_set=["VTODO"])
        if color:
            try:
                cal.set_properties([dav_ical.CalendarColor(color)])
            except Exception:  # noqa: BLE001
                pass
        self._cal_cache = None
        return {"id": str(cal.url).rstrip("/").split("/")[-1], "nombre": nombre, "color": color}

    def cambiar_lista(self, lista_id: str, nombre: str | None = None, color: str | None = None) -> None:
        from caldav.elements import dav  # noqa: PLC0415
        cal = self._cal(lista_id)["obj"]
        props = []
        if nombre:
            props.append(dav.DisplayName(nombre))
        if color:
            props.append(dav_ical.CalendarColor(color))
        if props:
            cal.set_properties(props)
        self._cal_cache = None

    # ── tareas ──
    def tareas(self, incluir_hechas_dias: int = 30) -> list[dict]:
        out = []
        limite = dt.datetime.now(TZ) - dt.timedelta(days=incluir_hechas_dias)
        for c in self.calendarios():
            if not (c["tareas"] and c["propio"]):
                continue
            try:
                todos = c["obj"].todos(include_completed=True)
            except Exception as e:  # noqa: BLE001
                raise SinNextcloud(f"no se pudo leer la lista {c['nombre']}: {type(e).__name__}") from e
            for t in todos:
                d = a_dict(t.icalendar_component, c["id"])
                if d["hecha"] and d["completada"] and _fecha(d["completada"]) < limite:
                    continue
                out.append(d)
        return out

    def _buscar(self, uid: str):
        for c in self.calendarios():
            if not (c["tareas"] and c["propio"]):
                continue
            try:
                return c, c["obj"].todo_by_uid(uid)
            except Exception:  # noqa: BLE001
                continue
        raise KeyError(uid)

    def crear(self, datos: dict) -> dict:
        c = self._cal(datos["lista"])
        cal = Calendar()
        cal.add("prodid", PRODID)
        cal.add("version", "2.0")
        todo = Todo()
        uid = datos.get("uid") or str(uuid.uuid4()).upper()
        ahora = dt.datetime.now(dt.timezone.utc)
        todo.add("uid", uid)
        todo.add("dtstamp", ahora)
        todo.add("created", ahora)
        aplicar(todo, datos)
        cal.add_component(todo)
        c["obj"].save_todo(cal.to_ical().decode())
        return a_dict(todo, c["id"])

    def actualizar(self, uid: str, cambios: dict) -> dict:
        c, obj = self._buscar(uid)
        comp = obj.icalendar_component
        if cambios.get("lista") and cambios["lista"] != c["id"]:
            # cambiar de lista = crearla en la nueva con el mismo UID y borrarla de la vieja
            datos = a_dict(comp, c["id"]) | cambios
            nueva = self.crear(datos | {"uid": uid})
            obj.delete()
            return nueva
        aplicar(comp, cambios)
        obj.save()
        return a_dict(comp, c["id"])

    def completar(self, uid: str, hecha: bool = True) -> dict:
        c, obj = self._buscar(uid)
        comp = obj.icalendar_component
        if hecha and comp.get("rrule") and comp.get("due"):
            siguiente = siguiente_fecha(comp)
            if siguiente is not None:
                d = a_dict(comp, c["id"])
                aplicar(comp, {"vence": siguiente.isoformat() if isinstance(siguiente, dt.datetime) else siguiente.isoformat(),
                               "con_hora": isinstance(siguiente, dt.datetime), "aviso_min": d["aviso_min"]})
                obj.save()
                return a_dict(comp, c["id"]) | {"repetida": True}
        for k in ("status", "completed", "percent-complete"):
            comp.pop(k, None)
        if hecha:
            comp.add("status", "COMPLETED")
            comp.add("completed", dt.datetime.now(dt.timezone.utc))
            comp.add("percent-complete", 100)
        else:
            comp.add("status", "NEEDS-ACTION")
        _tocar(comp)
        obj.save()
        return a_dict(comp, c["id"])

    def borrar(self, uid: str) -> int:
        """Borra la tarea y sus subtareas (en Nextcloud quedan en su papelera 30 días)."""
        n = 0
        for t in [x for x in self.tareas(incluir_hechas_dias=3650) if x.get("padre") == uid]:
            n += self.borrar(t["uid"])
        _, obj = self._buscar(uid)
        obj.delete()
        return n + 1

    # ── eventos ──
    def eventos(self, desde: dt.datetime, hasta: dt.datetime) -> list[dict]:
        out = []
        for c in self.calendarios():
            if not c["eventos"]:
                continue
            try:
                res = c["obj"].search(start=desde, end=hasta, event=True, expand=True)
            except Exception:  # noqa: BLE001
                continue
            for ev in res:
                comp = ev.icalendar_component
                ini = comp.get("dtstart").dt if comp.get("dtstart") else None
                fin = comp.get("dtend").dt if comp.get("dtend") else None
                aviso_min = _aviso_evento(comp, ini)
                out.append({"uid": str(comp.get("uid")), "titulo": str(comp.get("summary") or "(sin título)"),
                            "calendario": c["nombre"], "cal_id": c["id"], "color": c["color"],
                            "todo_el_dia": not isinstance(ini, dt.datetime),
                            "inicio": _iso(ini), "fin": _iso(fin), "lugar": str(comp.get("location") or "") or None,
                            "notas": str(comp.get("description") or ""),
                            "aviso": "BEGIN:VALARM" in (ev.data or ""),   # 2026-11-07: los «recordatorios» del calendario
                            "aviso_min": aviso_min,
                            # fase 2: la serie entera se edita, pero sus fechas solo se cambian en el iPhone
                            "recurrente": comp.get("rrule") is not None or comp.get("recurrence-id") is not None,
                            "editable": _cal_editable(c)})
        out.sort(key=lambda e: e["inicio"] or "")
        return out

    # ── eventos: crear, cambiar, borrar (fase 2, 2026-11-07) ──
    def calendarios_eventos(self) -> list[dict]:
        """Calendarios de eventos en los que Agenda puede escribir (los propios; no el de cumpleaños de contactos)."""
        return [{k: c[k] for k in ("id", "nombre", "color")} for c in self.calendarios() if _cal_editable(c)]

    def _buscar_evento(self, uid: str):
        for c in self.calendarios():
            if not _cal_editable(c):
                continue
            try:
                return c, c["obj"].event_by_uid(uid)
            except Exception:  # noqa: BLE001
                continue
        raise KeyError(uid)

    def crear_evento(self, datos: dict) -> dict:
        c = self._cal(datos["calendario"])
        if not _cal_editable(c):
            raise KeyError(datos["calendario"])
        cal = Calendar()
        cal.add("prodid", PRODID)
        cal.add("version", "2.0")
        ev = Event()
        ahora = dt.datetime.now(dt.timezone.utc)
        ev.add("uid", datos.get("uid") or str(uuid.uuid4()).upper())
        ev.add("dtstamp", ahora)
        ev.add("created", ahora)
        aplicar_evento(ev, datos)
        ev.add("sequence", 0)
        cal.add_component(ev)
        _con_zonas(cal)
        c["obj"].save_event(cal.to_ical().decode())
        return evento_dict(ev, c)

    def actualizar_evento(self, uid: str, cambios: dict) -> dict:
        c, obj = self._buscar_evento(uid)
        comp = obj.icalendar_component
        if comp.get("rrule") is not None and ({"inicio", "fin", "todo_el_dia"} & cambios.keys()):
            raise ValueError("es un evento que se repite: su fecha se cambia en el Calendario del iPhone")
        if cambios.get("calendario") and cambios["calendario"] != c["id"]:
            # cambiar de calendario = copiar el evento entero (con sus propiedades) al nuevo y borrar el viejo
            nuevo_cal = self._cal(cambios["calendario"])
            if not _cal_editable(nuevo_cal):
                raise KeyError(cambios["calendario"])
            aplicar_evento(comp, cambios)
            _con_zonas(obj.icalendar_instance)
            nuevo_cal["obj"].save_event(obj.icalendar_instance.to_ical().decode())
            obj.delete()
            return evento_dict(comp, nuevo_cal)
        aplicar_evento(comp, cambios)
        _con_zonas(obj.icalendar_instance)
        obj.save()
        return evento_dict(comp, c)

    def pasar_a_tarea(self, uid: str, lista: str, vence: str) -> dict:
        """Fase 3 (#275, 2026-11-07): convierte un evento-recordatorio en tarea (VTODO) y borra el evento.
        La tarea vence en la fecha de la ocurrencia elegida (`vence`, con hora si el evento la tiene), con el mismo
        título y notas, la repetición del evento si se repite (la serie entera pasa a ser UNA tarea que se repite)
        y el aviso equivalente. Primero se crea la tarea; el evento solo se borra si eso fue bien."""
        c, obj = self._buscar_evento(uid)
        comp = obj.icalendar_component
        if _ANIO_FINAL.search(str(comp.get("summary") or "")):
            raise ValueError("los cumpleaños se quedan en el calendario")
        ini = comp.get("dtstart").dt if comp.get("dtstart") else None
        con_hora = isinstance(ini, dt.datetime)
        aviso_ev = _aviso_evento(comp, ini)
        # aviso del evento: minutos antes del INICIO (día entero = las 0:00); el de la tarea: antes de su hora
        # (día entero = las 9:00). «El día antes a las 9:00» (900) → 1440; «el mismo día a las 9:00» (-540) → 0.
        aviso = None if aviso_ev is None else (aviso_ev if con_hora else max(0, aviso_ev + 540))
        rr = comp.get("rrule")
        datos = {"lista": lista, "titulo": str(comp.get("summary") or "(sin título)"),
                 "notas": str(comp.get("description") or ""), "vence": vence, "con_hora": con_hora,
                 "aviso_min": aviso, "repeticion": rr.to_ical().decode() if rr else None}
        lugar = str(comp.get("location") or "")
        if lugar:
            datos["notas"] = (datos["notas"] + "\n" if datos["notas"] else "") + "Lugar: " + lugar
        tarea = self.crear(datos)
        obj.delete()
        return tarea

    def borrar_evento(self, uid: str) -> None:
        """Borra el evento (si se repite, la serie entera). En Nextcloud queda 30 días en la papelera."""
        _, obj = self._buscar_evento(uid)
        obj.delete()


# ─────────────────────────── VTODO ↔ dict ───────────────────────────
def _iso(v) -> str | None:
    if v is None:
        return None
    if isinstance(v, dt.datetime):
        if v.tzinfo is None:
            v = v.replace(tzinfo=TZ)
        return v.astimezone(TZ).isoformat()
    return v.isoformat()


def _fecha(s: str) -> dt.datetime:
    d = dt.datetime.fromisoformat(s)
    return d if d.tzinfo else d.replace(tzinfo=TZ)


def _prioridad(p) -> str | None:
    try:
        p = int(p)
    except (TypeError, ValueError):
        return None
    return None if p == 0 else "alta" if p <= 4 else "media" if p == 5 else "baja"


def a_dict(comp, lista: str) -> dict:
    due = comp.get("due").dt if comp.get("due") else None
    ini = comp.get("dtstart").dt if comp.get("dtstart") else None
    cats = comp.get("categories")
    etiquetas: list[str] = []
    for grupo in (cats if isinstance(cats, list) else [cats] if cats else []):
        etiquetas += [str(x) for x in getattr(grupo, "cats", [])]
    padre = None
    rel = comp.get("related-to")
    for r in (rel if isinstance(rel, list) else [rel] if rel else []):
        if str(getattr(r, "params", {}).get("RELTYPE", "PARENT")).upper() == "PARENT":
            padre = str(r)
    aviso = None
    for sub in comp.subcomponents:
        if sub.name == "VALARM" and sub.get("trigger") is not None:
            trig = sub.get("trigger").dt
            if isinstance(trig, dt.timedelta):
                aviso = int(-trig.total_seconds() // 60)
            elif isinstance(trig, dt.datetime) and due is not None:
                # día entero: el aviso se cuenta desde las 9:00 de ese día (así lo escribe aplicar())
                base = due if isinstance(due, dt.datetime) else dt.datetime.combine(due, dt.time(9, 0), TZ)
                if base.tzinfo is None:
                    base = base.replace(tzinfo=TZ)
                aviso = int((base.astimezone(dt.timezone.utc) - trig.astimezone(dt.timezone.utc)).total_seconds() // 60)
            break
    rr = comp.get("rrule")
    estado = str(comp.get("status") or "").upper()
    return {"uid": str(comp.get("uid")), "lista": lista, "titulo": str(comp.get("summary") or ""),
            "notas": str(comp.get("description") or ""), "vence": _iso(due), "con_hora": isinstance(due, dt.datetime),
            "inicio": _iso(ini), "prioridad": _prioridad(comp.get("priority")), "etiquetas": etiquetas, "padre": padre,
            "repeticion": rr.to_ical().decode() if rr else None, "aviso_min": aviso,
            "hecha": estado == "COMPLETED" or comp.get("completed") is not None,
            "completada": _iso(comp.get("completed").dt) if comp.get("completed") else None,
            "creada": _iso(comp.get("created").dt) if comp.get("created") else None,
            "modificada": _iso(comp.get("last-modified").dt) if comp.get("last-modified") else None}


def _tocar(comp) -> None:
    for k in ("last-modified", "dtstamp"):
        comp.pop(k, None)
    ahora = dt.datetime.now(dt.timezone.utc)
    comp.add("last-modified", ahora)
    comp.add("dtstamp", ahora)


def _valor_fecha(texto: str, con_hora: bool):
    if con_hora:
        d = dt.datetime.fromisoformat(texto)
        return d if d.tzinfo else d.replace(tzinfo=TZ)
    return dt.date.fromisoformat(texto[:10])


def aplicar(comp, d: dict) -> None:
    """Escribe en el VTODO los campos presentes en d (los ausentes no se tocan)."""
    if "titulo" in d:
        comp.pop("summary", None)
        comp.add("summary", (d["titulo"] or "").strip() or "(sin título)")
    if "notas" in d:
        comp.pop("description", None)
        if d["notas"]:
            comp.add("description", d["notas"])
    if "vence" in d:
        comp.pop("due", None)
        if d["vence"]:
            comp.add("due", _valor_fecha(d["vence"], bool(d.get("con_hora"))))
    if "inicio" in d:
        comp.pop("dtstart", None)
        if d["inicio"]:
            comp.add("dtstart", _valor_fecha(d["inicio"], "T" in d["inicio"]))
    if "prioridad" in d:
        comp.pop("priority", None)
        valor = {"alta": 1, "media": 5, "baja": 9}.get(d["prioridad"] or "")
        if valor:
            comp.add("priority", valor)
    if "etiquetas" in d:
        comp.pop("categories", None)
        etq = [e.strip().lstrip("#") for e in (d["etiquetas"] or []) if e and e.strip()]
        if etq:
            comp.add("categories", etq)
    if "padre" in d:
        comp.pop("related-to", None)
        if d["padre"]:
            comp.add("related-to", d["padre"], parameters={"RELTYPE": "PARENT"})
    if "repeticion" in d:
        comp.pop("rrule", None)
        if d["repeticion"]:
            comp.add("rrule", vRecur.from_ical(d["repeticion"].removeprefix("RRULE:")))
    if "aviso_min" in d or "vence" in d:
        comp.subcomponents = [s for s in comp.subcomponents if s.name != "VALARM"]
        due = comp.get("due").dt if comp.get("due") else None
        minutos = d.get("aviso_min")
        if minutos is not None and due is not None:
            momento = due if isinstance(due, dt.datetime) else dt.datetime.combine(due, dt.time(9, 0), TZ)
            alarma = Alarm()
            alarma.add("action", "DISPLAY")
            alarma.add("description", "Recordatorio")
            # disparo absoluto con VALUE=DATE-TIME (lo exige el estándar; sin él el iPhone puede ignorar el aviso)
            alarma.add("trigger", (momento - dt.timedelta(minutes=int(minutos))).astimezone(dt.timezone.utc),
                       parameters={"VALUE": "DATE-TIME"})
            alarma.add("uid", str(uuid.uuid4()).upper())
            comp.add_component(alarma)
    if "hecha" in d and "status" not in comp:
        comp.add("status", "COMPLETED" if d["hecha"] else "NEEDS-ACTION")
    if "status" not in comp:
        comp.add("status", "NEEDS-ACTION")
    _tocar(comp)


# ─────────────────────────── VEVENT (fase 2) ───────────────────────────
# Los avisos de los eventos van RELATIVOS al inicio, como los pone el iPhone (-PT15H = el día antes a las 9:00 en
# un evento de día entero). aviso_min = minutos ANTES del inicio (negativo = después: -540 = el mismo día a las 9:00).
import re as _re  # noqa: E402
_ANIO_FINAL = _re.compile(r"\(\d{4}\)\s*$")     # «Lucía (1980)»: un cumpleaños


def _con_zonas(cal) -> None:
    """Añade el VTIMEZONE de Europe/Madrid si hace falta (el iPhone lo agradece en eventos con hora)."""
    try:
        cal.add_missing_timezones()
    except Exception:  # noqa: BLE001
        pass


def _cal_editable(c: dict) -> bool:
    return c["eventos"] and c["propio"] and c["id"] != "contact_birthdays"


def _aviso_evento(comp, ini) -> int | None:
    for sub in comp.subcomponents:
        if sub.name == "VALARM" and sub.get("trigger") is not None:
            trig = sub.get("trigger").dt
            if isinstance(trig, dt.timedelta):
                return int(-trig.total_seconds() // 60)
            if isinstance(trig, dt.datetime) and ini is not None:
                base = ini if isinstance(ini, dt.datetime) else dt.datetime.combine(ini, dt.time(0, 0), TZ)
                if base.tzinfo is None:
                    base = base.replace(tzinfo=TZ)
                return int((base - trig).total_seconds() // 60)
    return None


def evento_dict(comp, c: dict) -> dict:
    ini = comp.get("dtstart").dt if comp.get("dtstart") else None
    fin = comp.get("dtend").dt if comp.get("dtend") else None
    return {"uid": str(comp.get("uid")), "titulo": str(comp.get("summary") or "(sin título)"), "calendario": c["nombre"],
            "cal_id": c["id"], "color": c["color"], "todo_el_dia": not isinstance(ini, dt.datetime),
            "inicio": _iso(ini), "fin": _iso(fin), "lugar": str(comp.get("location") or "") or None,
            "notas": str(comp.get("description") or ""), "aviso_min": _aviso_evento(comp, ini),
            "aviso": any(s.name == "VALARM" for s in comp.subcomponents),
            "recurrente": comp.get("rrule") is not None, "editable": _cal_editable(c)}


def aplicar_evento(comp, d: dict) -> None:
    """Escribe en el VEVENT los campos presentes en d. Las fechas van juntas: inicio, fin y todo_el_dia.
    Día entero: inicio y fin son fechas y el fin es EXCLUSIVO (un día = del 12 al 13), como en iCalendar."""
    if "titulo" in d:
        comp.pop("summary", None)
        comp.add("summary", (d["titulo"] or "").strip() or "(sin título)")
    if "notas" in d:
        comp.pop("description", None)
        if d["notas"]:
            comp.add("description", d["notas"])
    if "lugar" in d:
        comp.pop("location", None)
        if d["lugar"]:
            comp.add("location", d["lugar"])
    if "inicio" in d:
        dia_entero = bool(d.get("todo_el_dia"))
        ini = _valor_fecha(d["inicio"], not dia_entero)
        if d.get("fin"):
            fin = _valor_fecha(d["fin"], not dia_entero)
        else:
            fin = ini + (dt.timedelta(days=1) if dia_entero else dt.timedelta(hours=1))
        if fin <= ini:
            fin = ini + (dt.timedelta(days=1) if dia_entero else dt.timedelta(minutes=30))
        for k in ("dtstart", "dtend", "duration"):
            comp.pop(k, None)
        comp.add("dtstart", ini)
        comp.add("dtend", fin)
    if "aviso_min" in d:
        comp.subcomponents = [s for s in comp.subcomponents if s.name != "VALARM"]
        if d["aviso_min"] is not None:
            alarma = Alarm()
            alarma.add("action", "DISPLAY")
            alarma.add("description", "Recordatorio")
            alarma.add("trigger", -dt.timedelta(minutes=int(d["aviso_min"])))
            alarma.add("uid", str(uuid.uuid4()).upper())
            comp.add_component(alarma)
    _tocar(comp)          # SEQUENCE lo sube la librería caldav al guardar


def siguiente_fecha(comp):
    """La siguiente fecha de una tarea que se repite, a partir de hoy (o de su fecha si es futura)."""
    due = comp.get("due").dt
    regla = comp.get("rrule").to_ical().decode()
    es_dt = isinstance(due, dt.datetime)
    base = due if es_dt else dt.datetime.combine(due, dt.time(12, 0))
    if es_dt and base.tzinfo is None:
        base = base.replace(tzinfo=TZ)
    try:
        regla_obj = rrulestr(regla, dtstart=base)
    except (ValueError, TypeError):
        return None
    ahora = dt.datetime.now(TZ) if es_dt else dt.datetime.combine(dt.date.today(), dt.time(12, 0))
    referencia = max(base, ahora) if es_dt else max(base, ahora)
    sig = regla_obj.after(referencia, inc=False)
    if sig is None:
        return None
    return sig if es_dt else sig.date()
