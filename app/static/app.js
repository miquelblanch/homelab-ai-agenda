// Agenda (#275). Todo el texto entra por textContent (nada de innerHTML con datos).
(function () {
  "use strict";
  var E = {listas: [], tareas: [], eventos: [], ahora: null};
  var vista = {tipo: "hoy", id: null}, busqueda = "";
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  var DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  var DIA_ICAL = [["MO", "L"], ["TU", "M"], ["WE", "X"], ["TH", "J"], ["FR", "V"], ["SA", "S"], ["SU", "D"]];

  // ── fechas ──
  function hoyISO() { var d = new Date(); return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()); }
  function p2(n) { return (n < 10 ? "0" : "") + n; }
  function sumaDias(iso, n) { var d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()); }
  function diaDe(t) { return t.vence ? t.vence.slice(0, 10) : null; }
  function horaDe(t) { return t.con_hora && t.vence ? t.vence.slice(11, 16) : null; }
  function nombreDia(iso) {
    var h = hoyISO();
    if (iso === h) return "Hoy"; if (iso === sumaDias(h, 1)) return "Mañana"; if (iso === sumaDias(h, -1)) return "Ayer";
    var d = new Date(iso + "T12:00:00");
    var txt = DIAS[d.getDay()] + " " + d.getDate() + " " + d.toLocaleDateString("es-ES", {month: "short"});
    return txt.charAt(0).toUpperCase() + txt.slice(1);
  }
  function textoRep(r) {
    if (!r) return "";
    var f = /FREQ=(\w+)/.exec(r), i = /INTERVAL=(\d+)/.exec(r), by = /BYDAY=([\w,]+)/.exec(r);
    var n = i ? +i[1] : 1, base = {DAILY: ["cada día", "días"], WEEKLY: ["cada semana", "semanas"], MONTHLY: ["cada mes", "meses"], YEARLY: ["cada año", "años"]}[f ? f[1] : ""] || ["se repite", ""];
    var t = n > 1 ? "cada " + n + " " + base[1] : base[0];
    if (by) t += " (" + by[1].split(",").map(function (c) { var x = DIA_ICAL.find(function (d) { return d[0] === c; }); return x ? x[1] : c; }).join(" ") + ")";
    return t;
  }

  // ── datos ──
  function api(metodo, ruta, cuerpo) {
    return fetch(ruta, {method: metodo, headers: cuerpo ? {"Content-Type": "application/json"} : {}, body: cuerpo ? JSON.stringify(cuerpo) : undefined, credentials: "same-origin"})
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (r.status === 503) { aviso("Nextcloud no responde: no se puede guardar ahora. " + (j.detalle || "")); throw new Error("nextcloud"); }
          if (!r.ok) { aviso("No se pudo: " + (j.detalle || r.status)); throw new Error(r.status); }
          aviso(null); return j;
        });
      });
  }
  function aviso(t) { var a = $("aviso"); a.hidden = !t; a.textContent = t || ""; }
  function cargar() {
    cal.viejo = cal.cache; cal.cache = {};   // el calendario se vuelve a pedir, pero se pinta con lo anterior mientras llega
    return api("GET", "/api/estado").then(function (d) { E = d; pintar(); });
  }
  function lista(id) { return E.listas.find(function (l) { return l.id === id; }) || {nombre: "?", color: ""}; }
  function hijas(uid) { return E.tareas.filter(function (t) { return t.padre === uid; }); }
  function pendientes() { return E.tareas.filter(function (t) { return !t.hecha; }); }
  function principales(ts) { return ts.filter(function (t) { return !t.padre || !E.tareas.some(function (x) { return x.uid === t.padre; }); }); }
  function ordenar(ts) {
    var pr = {alta: 0, media: 1, baja: 2};
    return ts.slice().sort(function (a, b) {
      var da = a.vence || "9999", db = b.vence || "9999";
      if (da !== db) return da < db ? -1 : 1;
      return (pr[a.prioridad] ?? 3) - (pr[b.prioridad] ?? 3) || a.titulo.localeCompare(b.titulo);
    });
  }

  // ── barra lateral ──
  function pintarLado() {
    var h = hoyISO(), pend = principales(pendientes());
    var atras = pend.filter(function (t) { return diaDe(t) && diaDe(t) < h; }).length;
    var nHoy = pend.filter(function (t) { return diaDe(t) && diaDe(t) <= h; }).length;
    var nProx = pend.filter(function (t) { return diaDe(t) && diaDe(t) > h && diaDe(t) <= sumaDias(h, 7); }).length;
    nHoy += eventosDe(h).length;                                                    // y los eventos del calendario
    for (var i = 1; i <= 7; i++) nProx += eventosDe(sumaDias(h, i)).length;
    var v = $("vistas"); v.textContent = "";
    [["hoy", "☀︎  Hoy", nHoy, atras > 0], ["proximos", "🗓  Próximos 7 días", nProx], ["calendario", "📆  Calendario", null], ["todas", "☰  Todas", pend.length], ["hechas", "✓  Hechas", null]].forEach(function (q) {
      var a = el("a", vista.tipo === q[0] ? "on" : null); a.appendChild(el("span", null, q[1]));
      if (q[2]) a.appendChild(el("span", "n" + (q[3] ? " rojo" : ""), String(q[2])));
      a.addEventListener("click", function () { ir({tipo: q[0]}); }); v.appendChild(a);
    });
    var ls = $("listas"); ls.textContent = "";
    E.listas.forEach(function (l) {
      var a = el("a", vista.tipo === "lista" && vista.id === l.id ? "on" : null);
      var pt = el("span", "punto"); if (l.color) pt.style.background = l.color; a.appendChild(pt);
      a.appendChild(el("span", null, l.nombre));
      var n = principales(pendientes()).filter(function (t) { return t.lista === l.id; }).length;
      if (n) a.appendChild(el("span", "n", String(n)));
      a.addEventListener("click", function () { ir({tipo: "lista", id: l.id}); }); ls.appendChild(a);
    });
    var etq = {}; pendientes().forEach(function (t) { (t.etiquetas || []).forEach(function (e) { etq[e] = (etq[e] || 0) + 1; }); });
    var es = $("etiquetas"); es.textContent = "";
    Object.keys(etq).sort().forEach(function (e) {
      var a = el("a", vista.tipo === "etiqueta" && vista.id === e ? "on" : null, "#" + e);
      a.addEventListener("click", function () { ir({tipo: "etiqueta", id: e}); }); es.appendChild(a);
    });
    if (!Object.keys(etq).length) es.appendChild(el("span", "sub", "Ninguna todavía"));
  }

  // ── una tarea ──
  function fila(t, esHija) {
    var d = el("div", "tarea" + (t.hecha ? " hecha" : "") + (esHija ? " hija" : ""));
    var c = el("button", "check" + (t.prioridad && !t.hecha ? " p-" + t.prioridad : ""), t.hecha ? "✓" : "");
    c.type = "button"; c.setAttribute("aria-label", t.hecha ? "Marcar como pendiente" : "Marcar como hecha");
    c.addEventListener("click", function (ev) { ev.stopPropagation(); completar(t, d); });
    d.appendChild(c);
    var cu = el("div", "cuerpo"); cu.appendChild(el("div", "t", t.titulo));
    var m = el("div", "meta"), h = hoyISO(), dd = diaDe(t);
    if (dd) { var f = el("span", !t.hecha && dd < h ? "rojo" : null, nombreDia(dd) + (horaDe(t) ? " " + horaDe(t) : "")); m.appendChild(f); }
    if (t.aviso_min != null && !t.hecha) m.appendChild(el("span", null, "🔔"));
    if (t.repeticion) m.appendChild(el("span", null, "↻ " + textoRep(t.repeticion)));
    if (vista.tipo !== "lista" && !esHija) { var l = lista(t.lista), s = el("span"); var pt = el("span", "punto"); pt.style.display = "inline-block"; pt.style.width = "7px"; pt.style.height = "7px"; pt.style.marginRight = "4px"; if (l.color) pt.style.background = l.color; s.appendChild(pt); s.appendChild(document.createTextNode(l.nombre)); m.appendChild(s); }
    (t.etiquetas || []).forEach(function (e) { m.appendChild(el("span", "chip", "#" + e)); });
    var hs = hijas(t.uid); if (hs.length) m.appendChild(el("span", null, hs.filter(function (x) { return x.hecha; }).length + " de " + hs.length + " subtareas"));
    if (t.prioridad && !t.hecha) m.appendChild(el("span", "prio " + t.prioridad, t.prioridad));
    if (t.notas) m.appendChild(el("span", null, "📝"));
    if (m.children.length) cu.appendChild(m);
    d.appendChild(cu);
    d.addEventListener("click", function () { abrir(t); });
    return d;
  }
  // Un evento del calendario (cumpleaños, renovaciones…) en las vistas de tareas: solo lectura.
  function filaEvento(e) {
    var d = el("div", "tarea evento");
    if (e.color) d.style.setProperty("--c", e.color);
    d.appendChild(el("span", "ev-ico", e.aviso ? "🔔" : "📅"));
    var cu = el("div", "cuerpo"); cu.appendChild(el("div", "t", tituloEv(e)));
    var m = el("div", "meta");
    m.appendChild(el("span", null, e.todo_el_dia ? "todo el día" : e.inicio.slice(11, 16) + (e.fin ? "–" + e.fin.slice(11, 16) : "")));
    m.appendChild(el("span", null, e.calendario));
    if (e.lugar) m.appendChild(el("span", null, e.lugar));
    cu.appendChild(m); d.appendChild(cu);
    d.title = e.editable ? "Evento del calendario: tócalo para cambiarlo" : "Evento de un calendario de solo lectura";
    d.addEventListener("click", function () { abrirEvento(e); });
    return d;
  }
  // Cumpleaños con el año al final del título («Lucía (1980)») → «🎂 Lucía · cumple 46», con la edad
  // del año de ESE evento (no del de hoy). Igual que el aviso de las 10:00 por Telegram. El editor enseña el título real.
  function tituloEv(e) {
    var m = /^(.*?)\s*\((\d{4})\)\s*$/.exec(e.titulo || ""), anioEv = +(e.inicio || "").slice(0, 4);
    if (!m || !anioEv) return e.titulo;
    var edad = anioEv - +m[2];
    if (edad < 1 || edad > 120) return e.titulo;
    return "🎂 " + m[1].replace(/^🎂\s*/, "") + " · cumple " + edad;
  }
  function grupo(cont, titulo, ts, opc) {
    opc = opc || {};
    var evs = opc.eventos || [];
    if (!ts.length && !evs.length && !opc.siempre) return;
    var g = el("section", "grupo"), h = el("h2", opc.rojo ? "rojo" : null, titulo);
    if (ts.length + evs.length) h.appendChild(el("small", null, String(ts.length + evs.length)));
    g.appendChild(h);
    evs.forEach(function (e) { g.appendChild(filaEvento(e)); });
    if (!ts.length && !evs.length) g.appendChild(el("p", "vacio", opc.vacio || "Nada."));
    ordenar(ts).forEach(function (t) {
      g.appendChild(fila(t));
      if (!opc.sinHijas) ordenar(hijas(t.uid)).forEach(function (x) { if (!x.hecha || opc.conHechas) g.appendChild(fila(x, true)); });
    });
    cont.appendChild(g);
  }

  // ── vistas ──
  function pintar() {
    pintarLado(); pintarDia();
    $("dia").hidden = vista.tipo === "calendario";   // el calendario ya lo enseña todo
    var c = $("contenido"); c.textContent = "";
    var h = hoyISO(), pend = principales(pendientes()), tit = "", sub = "";
    if (busqueda) {
      var q = busqueda.toLowerCase();
      var res = E.tareas.filter(function (t) { return (t.titulo + " " + t.notas + " " + (t.etiquetas || []).join(" ")).toLowerCase().indexOf(q) >= 0; });
      tit = "Buscar"; sub = "«" + busqueda + "» · " + res.length + " resultados";
      grupo(c, "Pendientes", res.filter(function (t) { return !t.hecha; }), {sinHijas: true});
      grupo(c, "Hechas", res.filter(function (t) { return t.hecha; }), {sinHijas: true});
      if (!res.length) c.appendChild(el("p", "vacio", "Nada coincide."));
    } else if (vista.tipo === "hoy") {
      tit = "Hoy"; sub = nombreDia(h) === "Hoy" ? new Date().toLocaleDateString("es-ES", {weekday: "long", day: "numeric", month: "long"}) : "";
      grupo(c, "Atrasadas", pend.filter(function (t) { return diaDe(t) && diaDe(t) < h; }), {rojo: true});
      grupo(c, "Para hoy", pend.filter(function (t) { return diaDe(t) === h; }), {siempre: true, vacio: "Nada para hoy. 🎉", eventos: eventosDe(h)});
      grupo(c, "Hechas hoy", principales(E.tareas.filter(function (t) { return t.hecha && t.completada && t.completada.slice(0, 10) === h; })), {sinHijas: true});
    } else if (vista.tipo === "proximos") {
      tit = "Próximos 7 días";
      for (var i = 1; i <= 7; i++) {
        var dia = sumaDias(h, i);
        grupo(c, nombreDia(dia), pend.filter(function (t) { return diaDe(t) === dia; }), {siempre: true, vacio: "Nada.", eventos: eventosDe(dia)});
      }
    } else if (vista.tipo === "calendario") {
      var r = pintarCalendario(c); tit = r[0]; sub = r[1];
    } else if (vista.tipo === "todas") {
      tit = "Todas"; sub = pend.length + " pendientes";
      E.listas.forEach(function (l) { grupo(c, l.nombre, pend.filter(function (t) { return t.lista === l.id; })); });
    } else if (vista.tipo === "lista") {
      var l = lista(vista.id); tit = l.nombre;
      var lp = pend.filter(function (t) { return t.lista === vista.id; });
      sub = lp.length + " pendientes";
      grupo(c, "Con fecha", lp.filter(function (t) { return t.vence; }));
      grupo(c, "Sin fecha", lp.filter(function (t) { return !t.vence; }), {siempre: !lp.some(function (t) { return t.vence; }), vacio: "Lista vacía: añade algo arriba."});
      grupo(c, "Hechas (30 días)", principales(E.tareas.filter(function (t) { return t.lista === vista.id && t.hecha; })), {sinHijas: true});
      var b = el("button", "mini", "Renombrar o cambiar color"); b.type = "button"; b.style.marginTop = "18px";
      b.addEventListener("click", function () { editarLista(l); }); c.appendChild(b);
    } else if (vista.tipo === "etiqueta") {
      tit = "#" + vista.id;
      grupo(c, "Pendientes", pend.filter(function (t) { return (t.etiquetas || []).indexOf(vista.id) >= 0; }), {siempre: true});
    } else if (vista.tipo === "hechas") {
      tit = "Hechas"; sub = "Últimos 30 días";
      var hechas = E.tareas.filter(function (t) { return t.hecha; }), porDia = {};   // también las subtareas
      hechas.forEach(function (t) { var d = (t.completada || "").slice(0, 10) || "?"; (porDia[d] = porDia[d] || []).push(t); });
      Object.keys(porDia).sort().reverse().forEach(function (d) { grupo(c, d === "?" ? "Sin fecha" : nombreDia(d), porDia[d], {sinHijas: true}); });
      if (!hechas.length) c.appendChild(el("p", "vacio", "Todavía no has completado nada."));
    }
    $("titulo").textContent = tit; $("subtitulo").textContent = sub;
    document.title = tit + " · Agenda";
  }
  function eventosEn(evs, iso) { return (evs || []).filter(function (e) { return e.inicio && (e.inicio.slice(0, 10) === iso || (e.todo_el_dia && e.inicio <= iso && e.fin && e.fin > iso)); }); }
  function eventosDe(iso) { return eventosEn(E.eventos, iso); }

  // ── calendario (mes y semana): eventos de Nextcloud + tareas con fecha ──
  var MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  var cal = {modo: "mes", ref: null, sel: null, cache: {}, viejo: {}, pidiendo: {}};
  function lunesDe(iso) { var d = new Date(iso + "T12:00:00"), w = (d.getDay() + 6) % 7; return sumaDias(iso, -w); }
  function rangoCal() {
    if (cal.modo === "dia") return [cal.ref, 1];
    if (cal.modo === "semana") { var l = lunesDe(cal.ref); return [l, 7]; }
    return [lunesDe(cal.ref.slice(0, 8) + "01"), 42];
  }
  function eventosCal(desde, dias) {
    var clave = desde + "/" + dias;
    if (cal.cache[clave]) return cal.cache[clave];
    if (!cal.pidiendo[clave]) {
      cal.pidiendo[clave] = true;
      api("GET", "/api/eventos?desde=" + desde + "T00:00:00&hasta=" + sumaDias(desde, dias) + "T00:00:00")
        .then(function (evs) { cal.cache[clave] = evs; if (vista.tipo === "calendario") pintar(); })
        .catch(function () {}).then(function () { delete cal.pidiendo[clave]; });
    }
    return cal.viejo[clave] || null;
  }
  function tareasDe(iso) { return principales(E.tareas.filter(function (t) { return diaDe(t) === iso; })); }
  function moverCal(n) {
    if (n === 0) { cal.ref = cal.sel = hoyISO(); }
    else if (cal.modo === "dia") { cal.ref = cal.sel = sumaDias(cal.ref, n); }
    else if (cal.modo === "semana") { cal.ref = sumaDias(cal.ref, 7 * n); cal.sel = lunesDe(cal.ref); }
    else { var d = new Date(cal.ref.slice(0, 8) + "01T12:00:00"); d.setMonth(d.getMonth() + n); cal.ref = d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-01"; cal.sel = cal.ref.slice(0, 7) === hoyISO().slice(0, 7) ? hoyISO() : cal.ref; }
    pintar();
  }
  function chipEvento(e) {
    var b = el("div", "ci ev-c" + (e.todo_el_dia ? " todo" : ""));
    if (e.color) b.style.setProperty("--c", e.color);
    b.textContent = (e.todo_el_dia ? "" : e.inicio.slice(11, 16) + " ") + tituloEv(e);
    b.title = e.titulo + " · " + e.calendario + (e.lugar ? " · " + e.lugar : "");
    b.addEventListener("click", function (ev) { ev.stopPropagation(); abrirEvento(e); });
    arrastrable(b, "evento", e);
    return b;
  }
  function chipTarea(t) {
    var b = el("div", "ci ta-c" + (t.hecha ? " hecha" : ""));
    var l = lista(t.lista); if (l.color) b.style.setProperty("--c", l.color);
    b.textContent = (t.hecha ? "✓ " : "○ ") + (horaDe(t) ? horaDe(t) + " " : "") + t.titulo;
    b.title = t.titulo + " · " + l.nombre;
    b.addEventListener("click", function (ev) { ev.stopPropagation(); abrir(t); });
    arrastrable(b, "tarea", t);
    return b;
  }
  function pintarCalendario(c) {
    var h = hoyISO();
    if (!cal.ref) { cal.ref = h; cal.sel = h; }
    var r = rangoCal(), evs = eventosCal(r[0], r[1]);
    var barra = el("div", "cal-barra");
    [["‹", -1, "Anterior"], ["Hoy", 0, "Ir a hoy"], ["›", 1, "Siguiente"]].forEach(function (q) {
      var b = el("button", q[1] === 0 ? null : "mini", q[0]); b.type = "button"; b.setAttribute("aria-label", q[2]);
      b.addEventListener("click", function () { moverCal(q[1]); }); barra.appendChild(b);
    });
    var modos = el("div", "cal-modos");
    [["mes", "Mes"], ["semana", "Semana"], ["dia", "Día"]].forEach(function (q) {
      var b = el("button", cal.modo === q[0] ? "on" : null, q[1]); b.type = "button";
      b.addEventListener("click", function () { cal.modo = q[0]; cal.ref = cal.sel || cal.ref; pintar(); }); modos.appendChild(b);
    });
    barra.appendChild(modos);
    var nuevo = el("button", "primario", "+ Evento"); nuevo.type = "button";
    nuevo.addEventListener("click", function () { abrirEvento(null, cal.sel || h); });
    barra.appendChild(nuevo); c.appendChild(barra);
    if (!evs) c.appendChild(el("p", "sub", "Cargando el calendario de Nextcloud…"));
    if (cal.modo === "dia") return pintarVistaDia(c, evs);
    cal.scrollDia = null;
    var lista_ = evs || [];
    var rej = el("div", "cal " + cal.modo);
    ["L", "M", "X", "J", "V", "S", "D"].forEach(function (d) { rej.appendChild(el("div", "cal-cab", d)); });
    var mesRef = cal.ref.slice(0, 7), max = cal.modo === "mes" ? 3 : 99;
    for (var i = 0; i < r[1]; i++) {
      (function (iso) {
        var celda = el("div", "celda" + (iso === h ? " hoy" : "") + (iso === cal.sel ? " sel" : "") + (cal.modo === "mes" && iso.slice(0, 7) !== mesRef ? " fuera" : ""));
        celda.setAttribute("role", "button"); celda.tabIndex = 0;
        var num = el("div", "num", String(+iso.slice(8)));
        if (cal.modo === "semana") num.textContent = nombreDia(iso);
        celda.appendChild(num);
        var es = eventosEn(lista_, iso), ts = tareasDe(iso), items = [];
        es.filter(function (e) { return e.todo_el_dia; }).forEach(function (e) { items.push(chipEvento(e)); });
        ordenar(ts).forEach(function (t) { items.push(chipTarea(t)); });
        es.filter(function (e) { return !e.todo_el_dia; }).forEach(function (e) { items.push(chipEvento(e)); });
        items.slice(0, max).forEach(function (x) { celda.appendChild(x); });
        if (items.length > max) celda.appendChild(el("div", "mas", "+" + (items.length - max) + " más"));
        var puntos = el("div", "puntos");          // en el móvil, solo puntos
        items.slice(0, 4).forEach(function (x) { var p = el("span"); p.style.background = x.style.getPropertyValue("--c") || ""; puntos.appendChild(p); });
        if (items.length) celda.appendChild(puntos);
        var elegir = function () { cal.sel = iso; pintar(); };
        celda.addEventListener("click", elegir);
        celda.addEventListener("dblclick", function () { cal.sel = cal.ref = iso; cal.modo = "dia"; pintar(); });
        destino(celda, iso, null);
        celda.addEventListener("keydown", function (ev) { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); elegir(); } });
        rej.appendChild(celda);
      })(sumaDias(r[0], i));
    }
    c.appendChild(rej);
    // detalle del día elegido
    var det = el("section", "grupo cal-det");
    var es = eventosEn(lista_, cal.sel);
    var hd = el("h2", null, nombreDia(cal.sel)), verDia = el("button", "mini", "Ver el día ›"); verDia.type = "button";
    verDia.addEventListener("click", function () { cal.ref = cal.sel; cal.modo = "dia"; pintar(); });
    hd.appendChild(verDia); det.appendChild(hd);
    es.forEach(function (e) { det.appendChild(filaEvento(e)); });
    var ts = tareasDe(cal.sel);
    ordenar(ts).forEach(function (t) { det.appendChild(fila(t)); });
    if (!es.length && !ts.length) det.appendChild(el("p", "vacio", evs ? "Nada este día." : "…"));
    c.appendChild(det);
    var tit = cal.modo === "mes" ? MESES[+mesRef.slice(5) - 1] + " de " + mesRef.slice(0, 4)
      : "Semana del " + (+r[0].slice(8)) + " " + MESES[+r[0].slice(5, 7) - 1].slice(0, 3);
    return [tit.charAt(0).toUpperCase() + tit.slice(1), "Toca un día para el detalle (doble clic: vista de día) · arrastra eventos y tareas para cambiarlos de día"];
  }
  function pintarDia() {
    var d = $("dia"); d.textContent = ""; d.appendChild(el("h3", null, "📅 Calendario"));
    var h = hoyISO();
    [[h, "Hoy"], [sumaDias(h, 1), "Mañana"], [sumaDias(h, 2), nombreDia(sumaDias(h, 2))]].forEach(function (q) {
      d.appendChild(el("h4", null, q[1]));
      var evs = eventosDe(q[0]);
      if (!evs.length) { d.appendChild(el("p", "sub", "Sin eventos")); return; }
      evs.forEach(function (e) {
        var b = el("div", "ev"); if (e.color) b.style.borderLeftColor = e.color;
        b.appendChild(el("div", "h", e.todo_el_dia ? "todo el día" : e.inicio.slice(11, 16) + (e.fin ? "–" + e.fin.slice(11, 16) : "")));
        b.appendChild(el("div", null, tituloEv(e))); b.style.cursor = "pointer";
        b.addEventListener("click", function () { abrirEvento(e); }); d.appendChild(b);
      });
    });
  }
  // ── vista de día (fase 2): franja «todo el día» + horas; toca un hueco para crear un evento a esa hora ──
  var PX_H = 48;                                        // alto de una hora
  function minDe(iso) { return +iso.slice(11, 13) * 60 + +iso.slice(14, 16); }
  function hhmm(m) { return p2(Math.floor(m / 60)) + ":" + p2(m % 60); }
  function pintarVistaDia(c, evs) {
    var iso = cal.ref, lista_ = evs || [];
    var es = eventosEn(lista_, iso), ts = tareasDe(iso);
    var arriba = el("section", "dia-todo");
    arriba.appendChild(el("div", "dia-et", "Todo el día"));
    var fila_ = el("div", "dia-chips");
    es.filter(function (e) { return e.todo_el_dia; }).forEach(function (e) { fila_.appendChild(chipEvento(e)); });
    ordenar(ts.filter(function (t) { return !horaDe(t); })).forEach(function (t) { fila_.appendChild(chipTarea(t)); });
    if (!fila_.children.length) fila_.appendChild(el("span", "sub", "—"));
    destino(fila_, iso, null);
    arriba.appendChild(fila_); c.appendChild(arriba);

    var caja = el("div", "dia-horas"), lienzo = el("div", "dia-lienzo");
    lienzo.style.height = (24 * PX_H) + "px";
    for (var m = 0; m < 24 * 60; m += 30) {
      (function (m) {
        var hueco = el("div", "hueco" + (m % 60 ? " media" : ""));
        hueco.style.top = (m / 60 * PX_H) + "px"; hueco.style.height = (PX_H / 2) + "px";
        if (!(m % 60)) hueco.appendChild(el("span", "hora", hhmm(m)));
        hueco.title = "Nuevo evento a las " + hhmm(m);
        hueco.addEventListener("click", function () { abrirEvento(null, iso, hhmm(m)); });
        destino(hueco, iso, hhmm(m));
        lienzo.appendChild(hueco);
      })(m);
    }
    // bloques con hora (eventos y tareas) repartidos en carriles si se solapan
    var bloques = [];
    es.filter(function (e) { return !e.todo_el_dia; }).forEach(function (e) {
      var ini = e.inicio.slice(0, 10) < iso ? 0 : minDe(e.inicio);
      var fin = !e.fin || e.fin.slice(0, 10) > iso ? 24 * 60 : minDe(e.fin);
      bloques.push({ini: ini, fin: Math.max(fin, ini + 20), nodo: chipEvento(e)});
    });
    ts.filter(function (t) { return horaDe(t); }).forEach(function (t) {
      var ini = minDe(t.vence); bloques.push({ini: ini, fin: ini + 30, nodo: chipTarea(t)});
    });
    bloques.sort(function (a, b) { return a.ini - b.ini || b.fin - a.fin; });
    var carriles = [];
    bloques.forEach(function (b) {
      var k = 0; while (carriles[k] != null && carriles[k] > b.ini) k++;
      carriles[k] = b.fin; b.carril = k;
    });
    bloques.forEach(function (b) {
      var solapan = bloques.filter(function (x) { return x.ini < b.fin && b.ini < x.fin; });
      var n = Math.max.apply(null, solapan.map(function (x) { return x.carril; })) + 1;
      b.nodo.classList.add("bloque");
      b.nodo.style.top = (b.ini / 60 * PX_H) + "px";
      b.nodo.style.height = Math.max(20, (b.fin - b.ini) / 60 * PX_H - 2) + "px";
      b.nodo.style.left = "calc(52px + (100% - 56px) * " + (b.carril / n) + ")";
      b.nodo.style.width = "calc((100% - 56px) / " + n + " - 3px)";
      lienzo.appendChild(b.nodo);
    });
    if (iso === hoyISO()) {                               // la raya de «ahora»
      var ahora = new Date(), raya = el("div", "ahora");
      raya.style.top = ((ahora.getHours() * 60 + ahora.getMinutes()) / 60 * PX_H) + "px"; lienzo.appendChild(raya);
    }
    caja.appendChild(lienzo); c.appendChild(caja);
    var primera = bloques.length ? Math.min.apply(null, bloques.map(function (b) { return b.ini; })) : 8 * 60;
    var ir_ = Math.max(0, (iso === hoyISO() ? new Date().getHours() * 60 : primera) - 60);   // hoy: la hora actual
    // se repinta a menudo (al llegar los eventos, cada minuto): conservar dónde estaba el scroll en ese día
    if (cal.scrollDia !== iso) { cal.scrollDia = iso; cal.scrollPos = ir_ / 60 * PX_H; }
    var pos = cal.scrollPos;
    setTimeout(function () { caja.scrollTop = pos; }, 0);
    caja.addEventListener("scroll", function () { cal.scrollPos = caja.scrollTop; });
    var d = new Date(iso + "T12:00:00");
    var tit = nombreDia(iso);
    var sub = d.toLocaleDateString("es-ES", {weekday: "long", day: "numeric", month: "long", year: "numeric"}) + " · toca una hora libre para crear un evento · arrastra para moverlo";
    return [tit, sub];
  }

  // ── arrastrar y soltar (fase 2): eventos y tareas a otro día (mes, semana) o a otra hora (día) ──
  var arrastre = null;
  function arrastrable(nodo, tipo, obj) {
    if (tipo === "evento" && (!obj.editable || obj.recurrente)) return;   // las series se mueven en el iPhone
    if (tipo === "tarea" && obj.hecha) return;
    nodo.draggable = true;
    nodo.addEventListener("dragstart", function (ev) {
      arrastre = {tipo: tipo, obj: obj}; ev.dataTransfer.effectAllowed = "move";
      try { ev.dataTransfer.setData("text/plain", obj.titulo); } catch (e) { /* Safari */ }
      nodo.classList.add("arrastrando");
    });
    nodo.addEventListener("dragend", function () { nodo.classList.remove("arrastrando"); arrastre = null; document.querySelectorAll(".encima").forEach(function (x) { x.classList.remove("encima"); }); });
  }
  function destino(nodo, iso, hora) {
    nodo.addEventListener("dragover", function (ev) { if (arrastre) { ev.preventDefault(); nodo.classList.add("encima"); } });
    nodo.addEventListener("dragleave", function () { nodo.classList.remove("encima"); });
    nodo.addEventListener("drop", function (ev) {
      ev.preventDefault(); nodo.classList.remove("encima");
      if (arrastre) { var a = arrastre; arrastre = null; moverA(a, iso, hora); }
    });
  }
  function localISO(d) { return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()) + "T" + p2(d.getHours()) + ":" + p2(d.getMinutes()) + ":00"; }
  function moverA(a, iso, hora) {
    var o = a.obj, p;
    if (a.tipo === "tarea") {
      var h = hora || horaDe(o);
      if (diaDe(o) === iso && h === horaDe(o)) return;
      p = api("PATCH", "/api/tareas/" + encodeURIComponent(o.uid), {vence: h ? iso + "T" + h + ":00" : iso, con_hora: !!h, aviso_min: o.aviso_min});
      notar("Movida: «" + o.titulo + "» → " + nombreDia(iso).toLowerCase() + (h ? " " + h : ""));
    } else {
      var cambios;
      if (o.todo_el_dia && !hora) {                      // día entero → otro día (conserva cuántos días dura)
        var dias = Math.round((new Date(o.fin + "T12:00:00") - new Date(o.inicio + "T12:00:00")) / 864e5) || 1;
        if (o.inicio.slice(0, 10) === iso) return;
        cambios = {todo_el_dia: true, inicio: iso, fin: sumaDias(iso, dias)};
      } else {
        var ini = new Date(o.inicio), dur = o.todo_el_dia ? 3600e3 : (o.fin ? new Date(o.fin) - ini : 3600e3);
        var nuevo = new Date(iso + "T" + (hora || (o.todo_el_dia ? "09:00" : o.inicio.slice(11, 16))) + ":00");
        if (!o.todo_el_dia && nuevo.getTime() === ini.getTime()) return;
        cambios = {todo_el_dia: false, inicio: localISO(nuevo), fin: localISO(new Date(nuevo.getTime() + dur))};
      }
      p = api("PATCH", "/api/eventos/" + encodeURIComponent(o.uid), cambios);
      notar("Movido: «" + o.titulo + "» → " + nombreDia(iso).toLowerCase() + (cambios.todo_el_dia ? "" : " " + cambios.inicio.slice(11, 16)));
    }
    p.then(cargar).catch(function () {});
  }

  // ── editor de eventos (fase 2) ──
  var editEv = null;
  var AVISOS_HORA = [["", "Sin aviso"], ["0", "A la hora"], ["5", "5 min antes"], ["15", "15 min antes"], ["30", "30 min antes"], ["60", "1 h antes"], ["120", "2 h antes"], ["1440", "1 día antes"]];
  var AVISOS_DIA = [["", "Sin aviso"], ["-540", "El mismo día a las 9:00"], ["900", "El día antes a las 9:00"], ["2340", "2 días antes a las 9:00"], ["9540", "1 semana antes a las 9:00"]];
  function opcionesAviso(todo, valor) {
    var s = $("ev-aviso"); s.textContent = "";
    var ops = (todo ? AVISOS_DIA : AVISOS_HORA).slice();
    if (valor != null && !ops.some(function (o) { return o[0] === String(valor); })) ops.push([String(valor), "El que tenía (" + valor + " min)"]);
    ops.forEach(function (o) { var x = el("option", null, o[1]); x.value = o[0]; s.appendChild(x); });
    s.value = valor == null ? "" : String(valor);
  }
  function modoTodo() {
    var todo = $("ev-todo").checked;
    document.querySelectorAll("#editor-ev .ev-hora").forEach(function (x) { x.hidden = todo; });
  }
  function abrirEvento(e, dia, hora) {
    var nuevo = !e;
    if (nuevo && !(E.calendarios || []).length) { aviso("No hay ningún calendario de eventos en el que escribir."); return; }
    e = e || {titulo: "", cal_id: E.calendarios[0].id, todo_el_dia: !hora, editable: true,
      inicio: hora ? dia + "T" + hora : dia, fin: null, aviso_min: hora ? 15 : null, lugar: "", notas: ""};
    editEv = nuevo ? null : e;
    var soloLeer = !e.editable, fijas = !!e.recurrente;
    $("ev-titulo").value = e.titulo || "";
    var sel = $("ev-cal"); sel.textContent = "";
    (E.calendarios || []).forEach(function (k) { var o = el("option", null, k.nombre); o.value = k.id; sel.appendChild(o); });
    if (soloLeer) { var o = el("option", null, e.calendario); o.value = e.cal_id || ""; sel.appendChild(o); }
    sel.value = e.cal_id || "";
    $("ev-todo").checked = !!e.todo_el_dia;
    var ini = e.inicio || dia, fin = e.fin;
    $("ev-fecha").value = ini.slice(0, 10);
    $("ev-hora").value = e.todo_el_dia ? "" : ini.slice(11, 16);
    if (e.todo_el_dia) $("ev-fecha-fin").value = fin ? sumaDias(fin.slice(0, 10), -1) : ini.slice(0, 10);   // fin exclusivo → último día
    else $("ev-fecha-fin").value = fin ? fin.slice(0, 10) : ini.slice(0, 10);
    if (!e.todo_el_dia) {
      $("ev-hora-fin").value = fin ? fin.slice(11, 16) : hhmm(Math.min(minDe(ini) + 60, 23 * 60 + 59));
    } else $("ev-hora-fin").value = "";
    opcionesAviso(e.todo_el_dia, e.aviso_min);
    $("ev-lugar").value = e.lugar || ""; $("ev-notas").value = e.notas || "";
    ["ev-titulo", "ev-cal", "ev-aviso", "ev-lugar", "ev-notas"].forEach(function (id) { $(id).disabled = soloLeer; });
    ["ev-todo", "ev-fecha", "ev-hora", "ev-fecha-fin", "ev-hora-fin"].forEach(function (id) { $(id).disabled = soloLeer || fijas; });
    var nota = $("ev-nota");
    nota.hidden = !(soloLeer || fijas);
    nota.textContent = soloLeer ? "Este calendario es de solo lectura (lo genera Nextcloud): aquí solo se puede consultar."
      : fijas ? "Se repite: los cambios valen para toda la serie; las fechas se cambian en el Calendario del iPhone." : "";
    $("ev-guardar").hidden = soloLeer;
    $("ev-borrar").hidden = nuevo || soloLeer;
    // fase 3: un evento-recordatorio («Regar la orquídea», «Pedir cita…») puede pasar a ser tarea; los cumpleaños no
    var esCumple = /\(\d{4}\)\s*$/.test(e.titulo || "") || /cumple/i.test(e.calendario || "");
    $("ev-a-tarea-caja").hidden = nuevo || soloLeer || esCumple || !E.listas.length;
    if (!$("ev-a-tarea-caja").hidden) {
      var sl = $("ev-a-tarea-lista"); sl.textContent = "";
      E.listas.forEach(function (l) { var o = el("option", null, "a " + l.nombre); o.value = l.id; sl.appendChild(o); });
      var per = E.listas.find(function (l) { return l.nombre === "Personal"; }); if (per) sl.value = per.id;
    }
    $("ev-info").textContent = soloLeer ? e.calendario : "Se guarda en Nextcloud y aparece en el Calendario del iPhone";
    modoTodo();
    $("editor-ev").showModal();
    if (nuevo) $("ev-titulo").focus();
  }
  $("ev-cerrar").addEventListener("click", function () { $("editor-ev").close(); });
  $("ev-todo").addEventListener("change", function () {
    var todo = $("ev-todo").checked;
    if (!todo && !$("ev-hora").value) { $("ev-hora").value = "09:00"; $("ev-hora-fin").value = "10:00"; }
    opcionesAviso(todo, todo ? null : 15); modoTodo();
  });
  $("ev-fecha").addEventListener("change", function () { if (!$("ev-fecha-fin").value || $("ev-fecha-fin").value < $("ev-fecha").value) $("ev-fecha-fin").value = $("ev-fecha").value; });
  $("ev-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var todo = $("ev-todo").checked, f = $("ev-fecha").value, ff = $("ev-fecha-fin").value || f;
    var datos = {titulo: $("ev-titulo").value.trim(), calendario: $("ev-cal").value, lugar: $("ev-lugar").value.trim(),
      notas: $("ev-notas").value, aviso_min: $("ev-aviso").value === "" ? null : +$("ev-aviso").value};
    if (!datos.titulo || !f) return;
    if (!(editEv && editEv.recurrente)) {
      datos.todo_el_dia = todo;
      if (todo) { datos.inicio = f; datos.fin = sumaDias(ff < f ? f : ff, 1); }
      else {
        var h = $("ev-hora").value || "09:00", hf = $("ev-hora-fin").value;
        datos.inicio = f + "T" + h + ":00";
        datos.fin = hf ? ff + "T" + hf + ":00" : null;
      }
    }
    if (editEv && datos.calendario === editEv.cal_id) delete datos.calendario;
    var p = editEv ? api("PATCH", "/api/eventos/" + encodeURIComponent(editEv.uid), datos) : api("POST", "/api/eventos", datos);
    p.then(function (r) {
      $("editor-ev").close();
      notar((editEv ? "Guardado: «" : "Creado: «") + r.titulo + "» · " + nombreDia(r.inicio.slice(0, 10)).toLowerCase() + (r.todo_el_dia ? "" : " " + r.inicio.slice(11, 16)));
      return cargar();
    }).catch(function () {});
  });
  $("ev-a-tarea").addEventListener("click", function () {
    if (!editEv) return;
    var l = lista($("ev-a-tarea-lista").value);
    var vence = editEv.todo_el_dia ? editEv.inicio.slice(0, 10) : editEv.inicio.slice(0, 19);
    if (!confirm("¿Pasar «" + editEv.titulo + "» a tarea en la lista " + l.nombre + "?\n\nLa tarea vencerá el " + nombreDia(vence.slice(0, 10)).toLowerCase()
      + (editEv.recurrente ? " y se repetirá igual que el evento. Se borra el evento y TODAS sus repeticiones del calendario" : ". Se borra el evento del calendario")
      + " (queda 30 días en la papelera de Nextcloud).")) return;
    api("POST", "/api/eventos/" + encodeURIComponent(editEv.uid) + "/a-tarea", {lista: l.id, vence: vence}).then(function (t) {
      $("editor-ev").close();
      notar("Ahora es una tarea: «" + t.titulo + "» · " + nombreDia(diaDe(t)).toLowerCase() + " · " + lista(t.lista).nombre + (t.repeticion ? " · ↻" : ""));
      return cargar();
    }).catch(function () {});
  });
  $("ev-borrar").addEventListener("click", function () {
    if (!editEv) return;
    if (!confirm("¿Borrar «" + editEv.titulo + "»" + (editEv.recurrente ? " y TODAS sus repeticiones" : "") + "? (Queda 30 días en la papelera de Nextcloud)")) return;
    api("DELETE", "/api/eventos/" + encodeURIComponent(editEv.uid)).then(function () { $("editor-ev").close(); return cargar(); }).catch(function () {});
  });

  function ir(v) { vista = v; busqueda = ""; $("buscar").value = ""; location.hash = v.tipo + (v.id ? "/" + encodeURIComponent(v.id) : ""); $("lado").classList.remove("abierto"); pintar(); }

  // ── acciones ──
  function completar(t, nodo) {
    nodo.classList.add("saliendo");
    api("POST", "/api/tareas/" + encodeURIComponent(t.uid) + "/hecha", {hecha: !t.hecha}).then(function (r) {
      if (r.repetida) { var dd = diaDe(r); aviso(null); notar("↻ Se repite: la próxima es " + nombreDia(dd).toLowerCase() + (horaDe(r) ? " a las " + horaDe(r) : "")); }
      return cargar();
    }).catch(function () { nodo.classList.remove("saliendo"); });
  }
  function notar(t) { var a = $("rapido-ayuda"); a.hidden = false; a.textContent = t; clearTimeout(notar._t); notar._t = setTimeout(function () { a.hidden = true; }, 5000); }

  $("rapido").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var txt = $("rapido-texto").value.trim(); if (!txt) return;
    var cuerpo = {frase: txt, lista: vista.tipo === "lista" ? vista.id : null};
    var hayFecha = /\b(hoy|ayer|anteayer|mañana|manana|pasado|lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo|\d{1,2}\/\d{1,2}|en \d+ d)/i.test(txt);
    if (vista.tipo === "calendario" && cal.sel && !hayFecha) cuerpo.frase = txt + " " + (+cal.sel.slice(8)) + "/" + (+cal.sel.slice(5, 7));   // en el día elegido
    if (vista.tipo === "hoy" && !/\b(hoy|ayer|anteayer|mañana|manana|pasado|lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo|\d{1,2}\/\d{1,2}|en \d+ d)/i.test(txt)) cuerpo.frase = txt + " hoy";
    api("POST", "/api/rapido", cuerpo).then(function (t) {
      $("rapido-texto").value = "";
      notar("Añadida: «" + t.titulo + "»" + (t.vence ? " · " + nombreDia(diaDe(t)).toLowerCase() + (horaDe(t) ? " " + horaDe(t) : "") : "") + " · " + lista(t.lista).nombre);
      return cargar();
    });
  });
  $("rapido-texto").addEventListener("focus", function () { if ($("rapido-ayuda").hidden) notar("Fechas: hoy, mañana, el viernes, 15/11 · hora: 10:00, a las 6 de la tarde · #etiqueta · !!! alta, !! media, ! baja · @lista · cada día, cada martes y viernes"); });
  $("buscar").addEventListener("input", function () { busqueda = $("buscar").value.trim(); pintar(); });
  $("menu").addEventListener("click", function () { $("lado").classList.toggle("abierto"); });
  $("nueva-lista").addEventListener("click", function () {
    var n = prompt("Nombre de la lista nueva:"); if (!n || !n.trim()) return;
    var colores = ["#2a78d6", "#1baf7a", "#eda100", "#e87ba4", "#6250d6", "#eb6834"];
    api("POST", "/api/listas", {nombre: n.trim(), color: colores[E.listas.length % colores.length]}).then(function (l) { return cargar().then(function () { ir({tipo: "lista", id: l.id}); }); });
  });
  function editarLista(l) {
    var n = prompt("Nombre de la lista:", l.nombre); if (n == null) return;
    var col = prompt("Color (formato #rrggbb):", l.color || "#2a78d6"); if (col == null) return;
    api("PATCH", "/api/listas/" + encodeURIComponent(l.id), {nombre: n.trim() || l.nombre, color: /^#[0-9a-f]{6}$/i.test(col) ? col : null}).then(cargar);
  }
  document.addEventListener("keydown", function (e) {
    if (e.key === "n" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !$("editor").open && !$("editor-ev").open) { e.preventDefault(); $("rapido-texto").focus(); }
  });

  // ── editor ──
  var edit = null, subsNuevas = [];
  (function () {
    var cont = $("ed-dias");
    DIA_ICAL.forEach(function (d) { var l = el("label"), c = el("input"); c.type = "checkbox"; c.value = d[0]; l.appendChild(c); l.appendChild(document.createTextNode(d[1])); cont.appendChild(l); });
    $("ed-rep").addEventListener("change", function () { $("ed-dias").hidden = $("ed-rep").value !== "WEEKLY"; });
    $("ed-cerrar").addEventListener("click", function () { $("editor").close(); });
  })();
  function abrir(t) {
    edit = t; subsNuevas = [];
    $("ed-titulo").value = t.titulo; $("ed-notas").value = t.notas || "";
    var sel = $("ed-lista"); sel.textContent = ""; E.listas.forEach(function (l) { var o = el("option", null, l.nombre); o.value = l.id; sel.appendChild(o); }); sel.value = t.lista;
    $("ed-prioridad").value = t.prioridad || "";
    $("ed-fecha").value = diaDe(t) || ""; $("ed-hora").value = horaDe(t) || "";
    $("ed-aviso").value = t.aviso_min != null ? String(t.aviso_min) : "";
    $("ed-etiquetas").value = (t.etiquetas || []).join(", ");
    var r = t.repeticion || "", f = /FREQ=(\w+)/.exec(r), i = /INTERVAL=(\d+)/.exec(r), by = /BYDAY=([\w,]+)/.exec(r);
    $("ed-rep").value = f ? f[1] : ""; $("ed-intervalo").value = i ? i[1] : 1;
    $("ed-dias").querySelectorAll("input").forEach(function (c) { c.checked = by ? by[1].split(",").indexOf(c.value) >= 0 : false; });
    $("ed-dias").hidden = $("ed-rep").value !== "WEEKLY";
    pintarSubs();
    $("ed-borrar").hidden = !t.uid;
    $("ed-info").textContent = t.uid ? "Se guarda en Nextcloud y aparece en Recordatorios" : "";
    $("editor").showModal();
  }
  function pintarSubs() {
    var ul = $("ed-subtareas"); ul.textContent = "";
    var hs = edit.uid ? hijas(edit.uid) : [];
    hs.concat(subsNuevas.map(function (s) { return {titulo: s, nueva: true}; })).forEach(function (s) {
      var li = el("li", s.hecha ? "hecha" : null), c = el("input"); c.type = "checkbox"; c.checked = !!s.hecha; c.disabled = !!s.nueva;
      c.addEventListener("change", function () { api("POST", "/api/tareas/" + encodeURIComponent(s.uid) + "/hecha", {hecha: c.checked}).then(cargar).then(pintarSubs); });
      li.appendChild(c); li.appendChild(el("span", null, s.titulo + (s.nueva ? " (se añade al guardar)" : ""))); ul.appendChild(li);
    });
    if (!ul.children.length) ul.appendChild(el("li", "sub", "Ninguna"));
  }
  $("ed-add-sub").addEventListener("click", function () { var v = $("ed-nueva-sub").value.trim(); if (v) { subsNuevas.push(v); $("ed-nueva-sub").value = ""; pintarSubs(); } });
  $("ed-nueva-sub").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); $("ed-add-sub").click(); } });
  $("ed-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var fecha = $("ed-fecha").value, hora = $("ed-hora").value, rep = $("ed-rep").value, n = Math.max(1, +$("ed-intervalo").value || 1);
    var regla = "";
    if (rep) {
      regla = "FREQ=" + rep + (n > 1 ? ";INTERVAL=" + n : "");
      if (rep === "WEEKLY") { var dias = Array.prototype.filter.call($("ed-dias").querySelectorAll("input"), function (c) { return c.checked; }).map(function (c) { return c.value; }); if (dias.length) regla += ";BYDAY=" + dias.join(","); }
    }
    if (rep && !fecha) { fecha = hoyISO(); }
    var datos = {titulo: $("ed-titulo").value.trim(), notas: $("ed-notas").value, lista: $("ed-lista").value,
      prioridad: $("ed-prioridad").value || null, vence: fecha ? (hora ? fecha + "T" + hora + ":00" : fecha) : null, con_hora: !!(fecha && hora),
      aviso_min: $("ed-aviso").value === "" ? null : +$("ed-aviso").value, repeticion: regla || null,
      etiquetas: $("ed-etiquetas").value.split(",").map(function (s) { return s.trim(); }).filter(Boolean)};
    if (!datos.titulo) return;
    var p = edit.uid ? api("PATCH", "/api/tareas/" + encodeURIComponent(edit.uid), datos) : api("POST", "/api/tareas", datos);
    p.then(function (t) {
      return subsNuevas.reduce(function (pr, s) { return pr.then(function () { return api("POST", "/api/tareas", {titulo: s, lista: t.lista, padre: t.uid}); }); }, Promise.resolve());
    }).then(function () { $("editor").close(); return cargar(); });
  });
  $("ed-borrar").addEventListener("click", function () {
    var hs = hijas(edit.uid).length;
    if (!confirm("¿Borrar «" + edit.titulo + "»" + (hs ? " y sus " + hs + " subtareas" : "") + "? (Queda 30 días en la papelera de Nextcloud)")) return;
    api("DELETE", "/api/tareas/" + encodeURIComponent(edit.uid)).then(function () { $("editor").close(); return cargar(); });
  });

  // ── arranque ──
  function leerHash() {
    var m = /^#(\w+)(?:\/(.+))?$/.exec(location.hash);
    if (m && ["hoy", "proximos", "calendario", "todas", "hechas", "lista", "etiqueta"].indexOf(m[1]) >= 0) vista = {tipo: m[1], id: m[2] ? decodeURIComponent(m[2]) : null};
  }
  leerHash();
  window.addEventListener("hashchange", function () { leerHash(); if (E.ahora) pintar(); });
  cargar().catch(function () { $("contenido").textContent = ""; $("contenido").appendChild(el("p", "vacio", "No se pudo cargar Agenda.")); });
  setInterval(function () { if (!document.hidden && !$("editor").open && !$("editor-ev").open) cargar().catch(function () {}); }, 60000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden && !$("editor").open && !$("editor-ev").open) cargar().catch(function () {}); });
})();
