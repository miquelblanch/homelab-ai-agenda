# Agenda

Tareas y calendario a medida sobre **Nextcloud** (CalDAV), para una sola persona. La app es la interfaz; Nextcloud
guarda los datos y los sincroniza con **Recordatorios y Calendario del iPhone** (avisos nativos y Siri incluidos).

- **Tareas** = `VTODO` en las listas de tareas de Nextcloud (cada lista aparece como una lista en Recordatorios).
- **Eventos** = `VEVENT` de los calendarios de Nextcloud.
- **Sin base de datos propia:** lo que cambia en el iPhone aparece en Agenda, y al revés.

Parte de un homelab personal; el resto de piezas está en
[homelab-ai-platform](https://github.com/miquelblanch/homelab-ai-platform) y
[homelab-ai-monitoring](https://github.com/miquelblanch/homelab-ai-monitoring).

## Qué hace

| Vista | Qué enseña |
|---|---|
| **Hoy** | Atrasadas, tareas para hoy y los eventos del día (🔔 si tienen aviso) |
| **Próximos 7 días** | Día a día, tareas y eventos |
| **Calendario** | Mes, semana y día: eventos y tareas con fecha. Se arrastran para cambiarlos de día o de hora |
| **Listas, etiquetas, Hechas, Buscar** | Lo habitual de una app de tareas |

- **Añadir rápido** en lenguaje natural: «Llamar al taller mañana 10:00 #coche !!!», «regar las plantas cada martes y viernes».
- **Editor de tareas:** notas, lista, prioridad, fecha y hora, aviso, etiquetas, repetición y subtareas.
- **Editor de eventos:** crear, cambiar y borrar; día entero o con hora; aviso; lugar. Las series que se repiten
  se editan enteras, pero sus fechas se cambian en el iPhone.
- **Pasar a tarea:** convierte un evento que en realidad es una tarea («Pedir cita…») en una tarea de Recordatorios.
- **Cumpleaños:** si el título acaba en el año de nacimiento («Lucía (1980)»), sale «🎂 Lucía · cumple 46».
- Se escribe con las propiedades que entiende Recordatorios: `PRIORITY`, `CATEGORIES`, `RELATED-TO` para
  subtareas, `RRULE` y `VALARM` (disparo absoluto en tareas y relativo al inicio en eventos, como el iPhone).

## Puesta en marcha

```bash
cp .env.ejemplo .env      # y rellénalo
docker compose up -d --build
```

Abre `http://<máquina>:8878`.

| Variable | Para qué |
|---|---|
| `AGENDA_NC_URL` | CalDAV de Nextcloud, p. ej. `https://nextcloud.ejemplo/remote.php/dav` |
| `AGENDA_NC_USER`, `AGENDA_NC_PASSWORD` | Cuenta de Nextcloud. Mejor una **contraseña de aplicación** |
| `AGENDA_USER`, `AGENDA_PASSWORD` | Login de Agenda (HTTP Basic) |
| `AGENDA_TOKEN` | Opcional: los scripts entran con la cabecera `X-LAN-Token` |
| `AGENDA_SIN_LOGIN=1` | Quita el login. **Solo para pruebas en local** |

**El login es intercambiable** (`app/acceso.py`): si en el `PYTHONPATH` hay un módulo `lan_auth` con
`proteger(app, …)`, se usa ese (en casa, uno común a todos los portales, con Face ID); si no, HTTP Basic. Sin login
configurado, Agenda no arranca.

Para los ajustes propios de tu instalación usa `docker-compose.override.yml`: Compose lo carga solo y no se versiona.

## API

`GET /api/estado` (listas, tareas y eventos de 6 semanas) · `GET /api/eventos?desde=…&hasta=…` ·
`POST /api/rapido` · `POST/PATCH/DELETE /api/tareas[/{uid}]` · `POST /api/tareas/{uid}/hecha` ·
`POST/PATCH/DELETE /api/eventos[/{uid}]` · `POST /api/eventos/{uid}/a-tarea` · `POST/PATCH /api/listas`.

## Notas

- Las listas de tareas deben ser de la cuenta que usa Agenda, no compartidas desde otra.
- En el iPhone, la cuenta CalDAV necesita HTTPS (iOS no envía la contraseña por HTTP plano).
- Una tarea que se repite, al completarla, salta a su siguiente fecha en vez de quedar hecha, como en Recordatorios.
