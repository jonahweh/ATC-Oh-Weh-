// Flughafen "Lindenau International" (EDLX) – fiktiv.
// Zwei parallele Bahnen 09L/27R (Nord) und 09R/27L (Süd), Terminals dazwischen.
// Erzeugt das Rollweg-Netz (Graph), Stände, Holding Points und die Wegsuche.
(function (ATC) {
  const U = ATC.U;
  const AP = { icao: 'EDLX', name: 'Lindenau' };

  const nodes = {};      // id -> {id,x,y,type}
  const edges = [];      // {id,a,b,name,kind,len}
  const adj = {};        // nodeId -> [edgeIndex]
  AP.nodes = nodes; AP.edges = edges; AP.adj = adj;

  function N(id, x, y, type) {
    if (!nodes[id]) { nodes[id] = { id, x, y, type: type || 'twy' }; adj[id] = []; }
    return id;
  }
  function E(a, b, name, kind) {
    const na = nodes[a], nb = nodes[b];
    const e = { id: edges.length, a, b, name, kind: kind || 'twy', len: U.dist(na.x, na.y, nb.x, nb.y) };
    edges.push(e); adj[a].push(e.id); adj[b].push(e.id);
    return e;
  }
  function chain(ids, name, kind) { for (let i = 0; i < ids.length - 1; i++) E(ids[i], ids[i + 1], name, kind); }

  // ---------- Geometrie ----------
  const G = AP.geo = {
    rwyHalfLen: 2000, rwyWidth: 60, twyWidth: 23,
    yR: 860, yHP: 755, yNear: 620, yFar: 480, yLane: 380, yStandNose: 240, termHalfH: 230,
    CX: [-2000, -1400, -800, -200, 400, 1000, 1600, 2000],
    XW: -1700, XZ: 0, XE: 1700,
    T1: [-1110, -345], T2: [345, 1110],
    remoteYs: [300, 180, 60, -60, -180, -300], remoteNoseX: 1860
  };
  G.gates1 = Array.from({ length: 8 }, (_, i) => -1060 + i * 95);
  G.gates2 = Array.from({ length: 8 }, (_, i) => 395 + i * 95);

  AP.runways = {
    N: { id: 'N', y: G.yR, names: { 27: '27R', 9: '09L' }, conn: 'N' },
    S: { id: 'S', y: -G.yR, names: { 27: '27L', 9: '09R' }, conn: 'S' }
  };
  AP.stands = {};
  AP.hps = {};
  AP.exits = { N: [], S: [] };

  const F_STANDS = ['101', '108', '111', '118', '201', '208', '211', '218', '401', '402'];

  for (const s of [1, -1]) {
    const rw = s > 0 ? 'N' : 'S';
    const near = s > 0 ? 'A' : 'D', far = s > 0 ? 'B' : 'C', lane = s > 0 ? 'G' : 'H', cp = s > 0 ? 'N' : 'S';
    const yR = G.yR * s, yHP = G.yHP * s, yNear = G.yNear * s, yFar = G.yFar * s, yLane = G.yLane * s, yNose = G.yStandNose * s;

    // Äußerer Rollweg (B bzw. C) mit allen Kreuzungen
    const farXs = [...new Set([...G.CX, G.XW, G.XZ, G.XE])].sort((a, b) => a - b);
    chain(farXs.map(x => N(`${far}_${x}`, x, yFar)), far);
    // Innerer Rollweg (A bzw. D) an den Bahnverbindungen
    chain(G.CX.map(x => N(`${near}_${x}`, x, yNear)), near);
    // Bahnverbindungen N1..N8 / S1..S8 mit Holding Points
    const rwyNodes = [];
    G.CX.forEach((x, i) => {
      const nm = cp + (i + 1);
      const hp = N(`HP_${nm}`, x, yHP, 'hp');
      const rn = N(`R_${nm}`, x, yR, 'rwy');
      rwyNodes.push(rn);
      E(`${far}_${x}`, `${near}_${x}`, nm, 'twy').glue = true; // Verbinder zwischen den Parallelrollwegen
      E(`${near}_${x}`, hp, nm, 'twy');
      E(hp, rn, nm, 'rwyconn');
      AP.hps[nm] = {
        name: nm, node: hp, rwy: rw, x, y: yHP,
        tora: { 27: x + G.rwyHalfLen, 9: G.rwyHalfLen - x },
        depFor: i <= 2 ? 9 : (i >= 5 ? 27 : null)
      };
      AP.exits[rw].push({ name: nm, x, rnode: rn, hp, near: `${near}_${x}` });
    });
    chain(rwyNodes, AP.runways[rw].names[9] + '/' + AP.runways[rw].names[27], 'rwy');

    // Vorfeld-Rollgasse (G bzw. H) mit Ständen
    const laneXs = [G.XW, ...G.gates1, G.XZ, ...G.gates2, G.XE].sort((a, b) => a - b);
    chain(laneXs.map(x => N(`${lane}_${x}`, x, yLane, 'lane')), lane, 'lane');
    [[G.gates1, s > 0 ? 101 : 111], [G.gates2, s > 0 ? 201 : 211]].forEach(([xs, base]) => {
      xs.forEach((x, i) => {
        const id = String(base + i);
        const st = N(`ST_${id}`, x, yNose, 'stand');
        E(`${lane}_${x}`, st, id, 'stand');
        AP.stands[id] = {
          id, node: st, laneNode: `${lane}_${x}`, x, y: yNose, noseHdg: s > 0 ? 180 : 0,
          maxSpan: F_STANDS.includes(id) ? 80 : 65, side: rw, area: base < 200 ? 'T1' : 'T2'
        };
      });
    });
  }

  // Querrollwege W, Z, E zwischen Nord- und Südsystem, mit Remote- und Cargo-Ständen an W und E
  for (const [name, x] of [['W', G.XW], ['Z', G.XZ], ['E', G.XE]]) {
    const ids = [`B_${x}`, `G_${x}`];
    if (name !== 'Z') {
      G.remoteYs.forEach((y, i) => {
        const jn = N(`${name}_${y}`, x, y, 'twy');
        ids.push(jn);
        const id = String((name === 'W' ? 301 : 401) + i);
        const nx = name === 'W' ? -G.remoteNoseX : G.remoteNoseX;
        const st = N(`ST_${id}`, nx, y, 'stand');
        E(jn, st, id, 'stand');
        AP.stands[id] = {
          id, node: st, laneNode: jn, x: nx, y, noseHdg: name === 'W' ? 270 : 90,
          maxSpan: F_STANDS.includes(id) ? 80 : 65, side: name, area: name === 'W' ? 'Remote' : 'Cargo'
        };
      });
    }
    ids.push(`H_${x}`, `C_${x}`);
    chain(ids, name, 'twy');
  }

  AP.standIds = Object.keys(AP.stands).sort();
  // Kreuzungen (mind. 3 Rollweg-/Standkanten): werden von Piloten "reserviert", damit nichts zusammenstößt
  AP.junction = {};
  for (const id in nodes) {
    const n = adj[id].filter(ei => edges[ei].kind !== 'rwy' && edges[ei].kind !== 'rwyconn').length;
    if (n >= 3) AP.junction[id] = true;
  }
  AP.hpNames = Object.keys(AP.hps);

  AP.rwyName = (rw, opDir) => AP.runways[rw].names[opDir];
  AP.depHps = (opDir) => AP.hpNames.filter(n => AP.hps[n].depFor === opDir);

  // ---------- Hilfen ----------
  AP.other = (e, id) => e.a === id ? e.b : e.a;
  AP.edgeBetween = (a, b) => {
    for (const ei of adj[a] || []) { const e = edges[ei]; if (AP.other(e, a) === b) return e; }
    return null;
  };
  AP.dirBetween = (a, b) => U.hdgOf(nodes[b].x - nodes[a].x, nodes[b].y - nodes[a].y);
  AP.namesOfNode = (id) => [...new Set((adj[id] || []).map(ei => edges[ei].name))];
  AP.twyNames = [...new Set(edges.filter(e => e.kind === 'twy' || e.kind === 'lane').map(e => e.name))].sort();

  // ---------- Standard-Rollrichtungen ----------
  // Betriebsrichtung 27: Ankünfte über W (Nord) bzw. E (Süd) aufs Vorfeld, Abflüge über Z/E bzw. Z/W hinaus.
  // Betriebsrichtung 09 ist das Spiegelbild (Ost <-> West).
  const FLOW27 = { A: 'W', B: 'E', C: 'E', D: 'W', G: 'E', H: 'W', W: 'S', E: 'N' };
  AP.flowOf = function (e, from, to, opDir) {
    const a = nodes[from], b = nodes[to];
    const dx = b.x - a.x, dy = b.y - a.y;
    let want;
    if (e.name === 'Z') want = (a.y + b.y) / 2 > 0 ? 'N' : 'S';
    else want = FLOW27[e.name];
    if (!want) return null;
    if (opDir === 9) want = { E: 'W', W: 'E', N: e.name === 'Z' ? 'N' : 'S', S: e.name === 'Z' ? 'S' : 'N' }[want];
    const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'E' : 'W') : (dy > 0 ? 'N' : 'S');
    return dir === want;
  };

  // ---------- Wegsuche ----------
  // start: {from, to} (auf Kante unterwegs zu 'to') oder {node, hdg}
  // dest: Knoten-ID. via: Liste von Rollweg-Namen oder null (= automatische Route).
  // opts: {destStand, allowReverse, maxTurn}
  AP.findRoute = function (start, dest, via, opts = {}) {
    const maxTurn = opts.maxTurn || 100;
    const destEdgeNames = new Set((adj[dest] || []).map(ei => edges[ei]).filter(e => e.kind !== 'rwyconn').map(e => e.name));
    let E2 = null;
    if (via && via.length) {
      E2 = via.slice();
      const last = E2[E2.length - 1];
      if (!destEdgeNames.has(last)) {
        // Zielname (z. B. N8 oder Stand 104) automatisch anhängen
        const dn = [...destEdgeNames].find(n => nodes[dest].type === 'stand' ? true : /^[NS]\d$/.test(n));
        if (dn) E2.push(dn);
      }
    }
    const startNames = new Set();
    const init = [];
    if (start.from != null) {
      const e = AP.edgeBetween(start.from, start.to);
      if (e) startNames.add(e.name);
      init.push({ prev: start.from, node: start.to, cost: 0, rev: false });
      if (opts.allowReverse) init.push({ prev: start.to, node: start.from, cost: 1500, rev: true });
    } else {
      init.push({ prev: null, node: start.node, cost: 0, hdg: start.hdg, rev: false });
    }

    const edgeAllowed = (e, nextNode) => {
      if (e.kind === 'rwy' || e.kind === 'rwyconn') return false;
      if (e.kind === 'stand') return nextNode === dest && nodes[dest].type === 'stand';
      return true;
    };

    const best = new Map();
    const open = [];
    const keyOf = (p, n, k) => p + '>' + n + '#' + k;
    for (const s of init) {
      const k = -1;
      const st = { prev: s.prev, node: s.node, k, cost: s.cost, parent: null, hdg: s.hdg, rev: s.rev };
      open.push(st); best.set(keyOf(s.prev, s.node, k), s.cost);
    }
    let found = null;
    let guard = 0;
    while (open.length && guard++ < 50000) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i].cost < open[bi].cost) bi = i;
      const cur = open.splice(bi, 1)[0];
      const kDone = E2 ? cur.k >= E2.length - 1 : true;
      if (cur.node === dest && kDone) { found = cur; break; }
      const inHdg = cur.prev != null ? AP.dirBetween(cur.prev, cur.node) : cur.hdg;
      for (const ei of adj[cur.node]) {
        const e = edges[ei];
        const nx = AP.other(e, cur.node);
        if (nx === cur.prev) continue;
        if (!edgeAllowed(e, nx)) continue;
        // keine Schleifen (ein Knoten höchstens einmal pro Route)
        let loop = false;
        for (let c = cur; c; c = c.parent) { if (c.node === nx || c.prev === nx) { loop = true; break; } }
        if (loop) continue;
        const outHdg = AP.dirBetween(cur.node, nx);
        const turn = inHdg == null ? 0 : Math.abs(U.angDiff(inHdg, outHdg));
        if (turn > maxTurn) continue;
        let k = cur.k;
        if (E2) {
          if (k === -1) {
            if (e.name === E2[0]) k = 0;
            else if (!startNames.has(e.name)) continue;
          } else if (e.name === E2[k]) { /* gleiche Rollbahn */ }
          else if (k + 1 < E2.length && e.name === E2[k + 1]) k = k + 1;
          else if (e.glue) { /* kurzer Verbinder A<->B bzw. C<->D darf implizit genutzt werden */ }
          else continue;
        }
        let cost = cur.cost + e.len + (turn / 90) * 25;
        if (opts.flow && AP.flowOf(e, cur.node, nx, opts.flow) === false) cost += 4000;
        const key = keyOf(cur.node, nx, k);
        if (best.has(key) && best.get(key) <= cost) continue;
        best.set(key, cost);
        open.push({ prev: cur.node, node: nx, k, cost, parent: cur, rev: cur.rev });
      }
    }
    if (!found) return null;
    const list = [];
    for (let c = found; c; c = c.parent) list.push(c);
    list.reverse();
    const nodeIds = [];
    if (list[0].prev != null) nodeIds.push(list[0].prev);
    for (const c of list) nodeIds.push(c.node);
    // Rollweg-Namen der Route (komprimiert), ohne Stand-Kanten
    const names = [];
    for (let i = 0; i < nodeIds.length - 1; i++) {
      const e = AP.edgeBetween(nodeIds[i], nodeIds[i + 1]);
      if (!e || e.kind === 'stand') continue;
      if (names[names.length - 1] !== e.name) names.push(e.name);
    }
    return { nodes: nodeIds, names, cost: found.cost, reversed: !!list[0].rev };
  };

  // Vorschlag für die "via"-Liste: Startrollweg und Ziel-Verbindung werden weggelassen.
  AP.viaFromNames = (names, startName, destNodeId) => {
    const v = names.slice();
    if (v.length > 1 && v[0] === startName) v.shift();
    const dn = destNodeId && nodes[destNodeId].type === 'hp' ? names[names.length - 1] : null;
    if (dn && v.length > 1 && v[v.length - 1] === dn) v.pop();
    return v;
  };

  // ---------- Pfadgeometrie mit abgerundeten Kurven ----------
  // raw: [{x,y,node}] -> {pts:[{x,y,s,vmax,node}], nodeS:{}, len}
  AP.buildPath = function (raw, R = 38) {
    const out = [];
    const push = (x, y, node, vmax) => out.push({ x, y, node: node || null, vmax: vmax || Infinity });
    push(raw[0].x, raw[0].y, raw[0].node);
    for (let i = 1; i < raw.length - 1; i++) {
      const p0 = raw[i - 1], p1 = raw[i], p2 = raw[i + 1];
      const L1 = U.dist(p0.x, p0.y, p1.x, p1.y), L2 = U.dist(p1.x, p1.y, p2.x, p2.y);
      if (L1 < 0.01 || L2 < 0.01) { push(p1.x, p1.y, p1.node); continue; }
      const d1 = { x: (p1.x - p0.x) / L1, y: (p1.y - p0.y) / L1 };
      const d2 = { x: (p2.x - p1.x) / L2, y: (p2.y - p1.y) / L2 };
      const dot = U.clamp(d1.x * d2.x + d1.y * d2.y, -1, 1);
      const ang = Math.acos(dot);
      if (ang < 0.04) { push(p1.x, p1.y, p1.node); continue; }
      let t = R * Math.tan(ang / 2);
      t = Math.min(t, L1 * 0.5, L2 * 0.5);
      const Rr = t / Math.tan(ang / 2);
      const a = { x: p1.x - d1.x * t, y: p1.y - d1.y * t };
      const cross = d1.x * d2.y - d1.y * d2.x;
      const n = cross > 0 ? { x: -d1.y, y: d1.x } : { x: d1.y, y: -d1.x };
      const c = { x: a.x + n.x * Rr, y: a.y + n.y * Rr };
      const a0 = Math.atan2(a.y - c.y, a.x - c.x);
      const b = { x: p1.x + d2.x * t, y: p1.y + d2.y * t };
      let a1 = Math.atan2(b.y - c.y, b.x - c.x);
      let da = a1 - a0;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      const steps = Math.max(3, Math.ceil(Math.abs(da) / 0.18));
      const vmax = Math.sqrt(0.9 * Math.max(Rr, 5));
      for (let k = 0; k <= steps; k++) {
        const aa = a0 + da * k / steps;
        push(c.x + Math.cos(aa) * Rr, c.y + Math.sin(aa) * Rr, k === Math.floor(steps / 2) ? p1.node : null, vmax);
      }
    }
    const last = raw[raw.length - 1];
    push(last.x, last.y, last.node);
    let s = 0;
    const nodeS = {};
    for (let i = 0; i < out.length; i++) {
      if (i > 0) s += U.dist(out[i - 1].x, out[i - 1].y, out[i].x, out[i].y);
      out[i].s = s;
      if (out[i].node && nodeS[out[i].node] == null) nodeS[out[i].node] = s;
    }
    return { pts: out, nodeS, len: s };
  };

  // Position/Kurs auf einem Pfad bei Strecke s
  AP.pathAt = function (path, s) {
    const p = path.pts;
    if (s <= 0) {
      const h = p.length > 1 ? U.hdgOf(p[1].x - p[0].x, p[1].y - p[0].y) : 0;
      return { x: p[0].x, y: p[0].y, hdg: h, i: 0 };
    }
    let lo = 0, hi = p.length - 1;
    while (lo < hi - 1) { const m = (lo + hi) >> 1; if (p[m].s <= s) lo = m; else hi = m; }
    const a = p[lo], b = p[Math.min(lo + 1, p.length - 1)];
    const seg = b.s - a.s;
    const t = seg > 0 ? U.clamp((s - a.s) / seg, 0, 1) : 0;
    return { x: U.lerp(a.x, b.x, t), y: U.lerp(a.y, b.y, t), hdg: seg > 0 ? U.hdgOf(b.x - a.x, b.y - a.y) : 0, i: lo };
  };

  // Tempolimit vorausschauend (Kurven) ab Strecke s
  AP.pathSpeedLimit = function (path, s, decel, look = 120) {
    let v = Infinity;
    for (const p of path.pts) {
      if (p.s < s - 1) continue;
      if (p.s > s + look) break;
      if (p.vmax < Infinity) v = Math.min(v, Math.sqrt(p.vmax * p.vmax + 2 * decel * Math.max(0, p.s - s)));
    }
    return v;
  };

  ATC.AP = AP;
})(ATC);
