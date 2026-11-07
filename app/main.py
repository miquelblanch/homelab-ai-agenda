"""Agenda: tareas y calendario a medida sobre Nextcloud, para una sola persona.

La app es la interfaz; Nextcloud guarda los datos y los sincroniza con el iPhone. El login es intercambiable
(ver acceso.py). La cuenta de Nextcloud va en AGENDA_NC_URL / AGENDA_NC_USER / AGENDA_NC_PASSWORD
(mejor con una contraseña de aplicación).
"""
from __future__ import annotations

import datetime as dt
from pathlib import Path

from fastapi import Body, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import acceso, rapido
from .nube import TZ, Nube, SinNextcloud

STATIC = Path(__file__).parent / "static"
app = FastAPI(title="Agenda")
MODO_ACCESO = acceso.proteger(app, STATIC)
nube = Nube()


@app.middleware("http")
async def revalidar(request: Request, call_next):
    resp = await call_next(request)
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@app.exception_handler(SinNextcloud)
async def sin_nextcloud(request: Request, exc: SinNextcloud):
    return JSONResponse({"error": "nextcloud", "detalle": str(exc)}, status_code=503)


@app.exception_handler(KeyError)
async def no_esta(request: Request, exc: KeyError):
    return JSONResponse({"error": "no_existe", "detalle": str(exc)}, status_code=404)


@app.exception_handler(ValueError)
async def no_vale(request: Request, exc: ValueError):
    return JSONResponse({"error": "no_vale", "detalle": str(exc)}, status_code=400)


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/estado")
def estado():
    """Todo lo que necesita la interfaz de una vez: listas, tareas (pendientes y hechas de 30 días) y eventos de 6 semanas."""
    hoy = dt.datetime.now(TZ).replace(hour=0, minute=0, second=0, microsecond=0)
    return {"ahora": dt.datetime.now(TZ).isoformat(), "listas": nube.listas(), "tareas": nube.tareas(),
            "calendarios": nube.calendarios_eventos(),
            "eventos": nube.eventos(hoy - dt.timedelta(days=7), hoy + dt.timedelta(days=42))}


@app.get("/api/eventos")
def eventos(desde: str, hasta: str):
    return nube.eventos(dt.datetime.fromisoformat(desde).replace(tzinfo=TZ), dt.datetime.fromisoformat(hasta).replace(tzinfo=TZ))


# ── eventos (fase 2, 2026-11-07): crear, cambiar (también moverlos de día u hora) y borrar ──
@app.post("/api/eventos")
def crear_evento(datos: dict = Body(...)):
    if not datos.get("titulo") or not datos.get("calendario") or not datos.get("inicio"):
        raise HTTPException(400, "falta el título, el calendario o la fecha")
    return nube.crear_evento(datos)


@app.patch("/api/eventos/{uid}")
def actualizar_evento(uid: str, cambios: dict = Body(...)):
    return nube.actualizar_evento(uid, cambios)


@app.post("/api/eventos/{uid}/a-tarea")
def pasar_a_tarea(uid: str, lista: str = Body(..., embed=True), vence: str = Body(..., embed=True)):
    return nube.pasar_a_tarea(uid, lista, vence)


@app.delete("/api/eventos/{uid}")
def borrar_evento(uid: str):
    nube.borrar_evento(uid)
    return {"ok": True}


@app.post("/api/rapido")
def rapido_(frase: str = Body(..., embed=True), lista: str | None = Body(None, embed=True), crear: bool = Body(True, embed=True)):
    datos = rapido.interpretar(frase, dt.datetime.now(TZ).date(), nube.listas())
    datos.setdefault("lista", lista or (nube.listas()[0]["id"] if nube.listas() else None))
    if datos.get("vence") and datos.get("con_hora"):
        datos.setdefault("aviso_min", 0)
    if not crear:
        return datos
    if not datos.get("lista"):
        raise HTTPException(400, "no hay ninguna lista de tareas")
    return nube.crear(datos)


@app.post("/api/tareas")
def crear(datos: dict = Body(...)):
    if not datos.get("titulo") or not datos.get("lista"):
        raise HTTPException(400, "falta el título o la lista")
    return nube.crear(datos)


@app.patch("/api/tareas/{uid}")
def actualizar(uid: str, cambios: dict = Body(...)):
    return nube.actualizar(uid, cambios)


@app.post("/api/tareas/{uid}/hecha")
def hecha(uid: str, hecha: bool = Body(True, embed=True)):
    return nube.completar(uid, hecha)


@app.delete("/api/tareas/{uid}")
def borrar(uid: str):
    return {"borradas": nube.borrar(uid)}


@app.post("/api/listas")
def crear_lista(nombre: str = Body(..., embed=True), color: str = Body("", embed=True)):
    return nube.crear_lista(nombre.strip(), color)


@app.patch("/api/listas/{lista_id}")
def cambiar_lista(lista_id: str, nombre: str | None = Body(None, embed=True), color: str | None = Body(None, embed=True)):
    nube.cambiar_lista(lista_id, nombre, color)
    return {"ok": True}


app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")
