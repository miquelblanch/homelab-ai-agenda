"""Agenda · quién puede entrar. El login es una pieza intercambiable:

1. Si está disponible el módulo `lan_auth` (el login común de los portales de casa: sesión con cookie, Face ID
   con passkeys e icono para el iPhone), se usa ese.
2. Si no, HTTP Basic con AGENDA_USER y AGENDA_PASSWORD. Los scripts pueden entrar con la cabecera
   `X-LAN-Token: <AGENDA_TOKEN>`.
3. AGENDA_SIN_LOGIN=1 lo quita todo. SOLO para pruebas en local.

Sin ninguna de las tres, Agenda no arranca: nunca queda abierta por olvido.
"""
from __future__ import annotations

import base64
import hmac
import os
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import PlainTextResponse

ABIERTAS = ("/api/health",)


def proteger(app: FastAPI, static: Path) -> str:
    if os.environ.get("AGENDA_SIN_LOGIN") == "1":
        return "sin login (solo pruebas)"
    try:
        import lan_auth  # noqa: PLC0415  (opcional: lo aporta quien despliega)
    except ImportError:
        lan_auth = None
    if lan_auth is not None:
        lan_auth.proteger(app, "Agenda", "AGENDA", icono="/static/favicon.svg",
                          icono_iphone=str(static / "apple-touch-icon.png"), nombre_iphone="Agenda")
        return "lan_auth"

    usuario, clave = os.environ.get("AGENDA_USER", ""), os.environ.get("AGENDA_PASSWORD", "")
    token = os.environ.get("AGENDA_TOKEN", "")
    if not usuario or not clave:
        raise RuntimeError("Agenda necesita login: define AGENDA_USER y AGENDA_PASSWORD "
                           "(o AGENDA_SIN_LOGIN=1, solo para pruebas en local)")
    esperado = base64.b64encode(f"{usuario}:{clave}".encode()).decode()

    @app.middleware("http")
    async def basico(request: Request, call_next):
        if request.url.path in ABIERTAS:
            return await call_next(request)
        if token and hmac.compare_digest(request.headers.get("x-lan-token", ""), token):
            return await call_next(request)
        cab = request.headers.get("authorization", "")
        if cab.startswith("Basic ") and hmac.compare_digest(cab[6:].strip(), esperado):
            return await call_next(request)
        return PlainTextResponse("Hace falta iniciar sesión", status_code=401,
                                 headers={"WWW-Authenticate": 'Basic realm="Agenda", charset="UTF-8"'})

    return "http basic"
