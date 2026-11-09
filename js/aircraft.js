// Flugzeug: Zustand, Bewegung am Boden (Pfade), Startlauf, Landung und Flug.
(function (ATC) {
  const U = ATC.U, AP = ATC.AP, D = ATC.D;

  // Bezeichnungen der Zustände für die Oberfläche
  ATC.STATE_LABEL = {
    PRE: 'Am Stand', CLR_REQ: 'Will Freigabe', CLR_RB: 'Readback', CLEARED: 'Freigabe erteilt',
    GND_WAIT: 'Wartet auf Bereitschaft', PB_REQ: 'Will Pushback', PB_HOLD: 'Pushback verzögert', PUSHING: 'Pushback',
    STARTUP: 'Triebwerksstart', TAXI_REQ: 'Rollbereit', TAXI: 'Rollt', AT_HP: 'Am Holding Point',
    TWR_HOLD: 'Bei Tower', LINEUP: 'Line-up', TAKEOFF: 'Startlauf', AIR: 'In der Luft',
    INB: 'Im Anflug', FINAL: 'Endanflug', LANDING: 'Landung', VACATING: 'Verlässt Bahn', ARR_TX_REQ: 'Will Rollfreigabe',
    PARKED: 'Geparkt', EMERG: 'Notfall', TOW_WAIT: 'Wartet auf Schlepper', CANCELLED: 'Annulliert', GONE: '—'
  };
  ATC.STATE_SHORT = {
    PRE: '', CLR_REQ: 'CLR?', CLR_RB: 'RB', CLEARED: 'CLRD', GND_WAIT: 'GND', PB_REQ: 'PB?', PB_HOLD: 'PB-H',
    PUSHING: 'PUSH', STARTUP: 'ST', TAXI_REQ: 'TX?', TAXI: 'TX', AT_HP: 'HP', TWR_HOLD: 'TWR', LINEUP: 'LU',
    TAKEOFF: 'TO', AIR: '', INB: 'APP', FINAL: 'FIN', LANDING: 'LDG', VACATING: 'VAC', ARR_TX_REQ: 'TX?',
    PARKED: 'PRK', EMERG: 'EMER', TOW_WAIT: 'TOW', CANCELLED: 'CNL', GONE: ''
  };

  class Aircraft {
    constructor(o) {
      Object.assign(this, o);
      this.T = D.TYPES[this.type];
      this.hl = this.T.len / 2; this.hw = this.T.span / 2;
      this.x = 0; this.y = 0; this.hdg = 0; this.v = 0; this.altFt = 0;
      this.onGround = true; this.visible = false;
      this.mode = null;          // 'path' | 'roll' | 'land' | 'air' | 'final' | null
      this.path = null; this.s = 0; this.endS = 0; this.reverse = false; this.routeNodes = null;
      this.holdPos = false; this.holdShort = null; this.giveWay = null; this.follow = null;
      this.blockedBy = null; this.blockedT = 0;
      this.waitSince = null; this.waitRole = null; this.calls = 0;
      this.handoff = null;
      this.plan = null; this.pilotPlan = null; this.rbPending = false;
      this.flags = {};
      this.seed = Math.floor(Math.random() * 1e6);
    }

    get id() { return this.cs; }
    get box() { return U.acShape(this.x, this.y, this.hdg, this.T.len, this.T.span); }
    get moving() { return this.v > 0.3; }

    // ----- Position auf dem Rollwegnetz für eine neue Wegsuche -----
    // Liefert {from,to} (auf Kante Richtung 'to') oder {node,hdg}.
    routeStart() {
      if (this.path && this.routeNodes && this.routeNodes.length > 1) {
        const ns = this.path.nodeS;
        let lastIdx = -1;
        for (let i = 0; i < this.routeNodes.length; i++) {
          const n = this.routeNodes[i];
          if (ns[n] != null && ns[n] <= this.s + 2) lastIdx = i;
        }
        const nextIdx = lastIdx + 1;
        if (nextIdx < this.routeNodes.length) {
          const to = this.routeNodes[nextIdx];
          let from = lastIdx >= 0 ? this.routeNodes[lastIdx] : this.routeFrom;
          if (from == null) from = this.routeFrom;
          if (from != null && from !== to && AP.edgeBetween(from, to)) return { from, to };
        }
        // Am Ende des Pfades: Ende-Knoten und dessen Vorgänger
        const n = this.routeNodes.length;
        if (n >= 2) {
          const a = this.routeNodes[n - 2], b = this.routeNodes[n - 1];
          // steht vor dem Endknoten (Nase am Knoten) -> Kante a->b, Ziel b
          return { from: a, to: b, atEnd: true };
        }
      }
      if (this.edgeHint) return this.edgeHint;
      return null;
    }

    // Pfad aus Knotenliste setzen. startPos: aktuelle Position als erster Punkt.
    setRoute(route, opts = {}) {
      const pts = [{ x: this.x, y: this.y, node: null }];
      const ids = route.nodes.slice(1);
      for (const id of ids) pts.push({ x: AP.nodes[id].x, y: AP.nodes[id].y, node: id });
      // Doppelte Startpunkte entfernen
      if (pts.length > 1 && U.dist(pts[0].x, pts[0].y, pts[1].x, pts[1].y) < 1) pts.splice(1, 1);
      this.path = AP.buildPath(pts);
      this.routeNodes = route.nodes.slice(1);
      this.routeFrom = route.nodes[0];
      this.s = 0;
      this.reverse = !!opts.reverse;
      this.mode = 'path';
      this.endS = Math.max(0, this.path.len - (opts.noseStop != null ? opts.noseStop + this.hl : 0));
      this.onPathEnd = opts.onEnd || null;
      this.maxV = opts.maxV || null;
      this.lookahead = opts.lookahead != null ? opts.lookahead : null;
      this.edgeHint = null;
    }

    clearInstructions() { this.holdPos = false; this.holdShort = null; this.giveWay = null; this.follow = null; }

    // Restliche Knoten der Route ab aktueller Position
    remainingNodes() {
      if (!this.path || !this.routeNodes) return [];
      return this.routeNodes.filter(n => this.path.nodeS[n] != null && this.path.nodeS[n] > this.s - 1);
    }

    // ----- Bodenbewegung -----
    updatePath(dt, sim) {
      const p = this.path;
      if (!p) { this.v = 0; return; }
      const decel = 1.4, acc = 0.9;
      let stopS = this.endS;
      const reasons = [];
      if (this.holdPos) { stopS = Math.min(stopS, this.s + (this.v * this.v) / (2 * decel)); reasons.push('hold'); }
      if (this.holdShort) {
        if (this.holdShort.s < this.s - 5) this.holdShort = null; // schon vorbei
        else stopS = Math.min(stopS, this.holdShort.s);
      }
      if (this.giveWay) {
        const g = this.giveWay, o = sim.byId[g.target];
        const oRem = o && o.onGround && o.mode === 'path' ? o.remainingNodes() : [];
        const stillAhead = o && o.onGround && oRem.includes(g.node);
        const nearby = o && U.dist(o.x, o.y, AP.nodes[g.node].x, AP.nodes[g.node].y) < o.hl + 45;
        if (!o || !o.onGround || (!stillAhead && !nearby)) { this.giveWay = null; }
        else if (p.nodeS[g.node] != null) stopS = Math.min(stopS, p.nodeS[g.node] - 45 - this.hl);
      }
      // Verkehr voraus (Piloten schauen raus)
      const tr = sim.trafficAhead(this);
      if (tr) {
        stopS = Math.min(stopS, tr.s);
        this.blockedBy = tr.other.id;
      } else this.blockedBy = null;

      // Kreuzungen: wer zuerst da ist, fährt; andere warten mit Flügelabstand
      if (this.routeNodes && !this.flags.pushing) {
        const look2 = Math.max(100, this.v * this.v / (2 * decel) + 60 + this.hl);
        for (const n of this.routeNodes) {
          const ns = p.nodeS[n];
          if (ns == null) continue;
          if (this.s > ns + this.hl + 30) { if (sim.locks[n] === this.cs) delete sim.locks[n]; continue; }
          if (ns > this.s + look2 + 60) break;
          if (!AP.junction[n]) continue;
          if (ns > this.endS + this.hl + 5) break;          // fahren wir nicht durch
          const clr = ns - (this.hl + 55);
          if (clr > stopS + 1) break;                       // halten ohnehin davor
          const holder = sim.locks[n];
          if (!holder || holder === this.cs || !sim.byId[holder]) { if (ns - this.s < look2 + 40) sim.locks[n] = this.cs; }
          else { stopS = Math.min(stopS, clr); if (!tr) this.blockedBy = holder; break; }
        }
      }

      let vmax = this.maxV || (sim.weather.lvp ? 6 : 10);
      const curve = AP.pathSpeedLimit(p, this.s, decel);
      const vStop = Math.sqrt(2 * decel * Math.max(0, stopS - this.s));
      const target = Math.min(vmax, curve, vStop);
      if (this.v < target) this.v = Math.min(target, this.v + acc * dt);
      else this.v = Math.max(target, this.v - decel * 1.6 * dt);
      if (stopS - this.s < 0.4 && this.v < 0.5) this.v = 0;
      this.s = Math.min(this.s + this.v * dt, Math.max(this.s, stopS));
      const at = AP.pathAt(p, this.s);
      this.x = at.x; this.y = at.y;
      this.hdg = this.reverse ? (at.hdg + 180) % 360 : at.hdg;

      if (this.blockedBy && this.v < 0.3) this.blockedT += dt; else this.blockedT = 0;

      if (this.s >= this.endS - 0.5 && this.v < 0.3) {
        const cb = this.onPathEnd;
        this.onPathEnd = null;
        this.v = 0;
        if (cb) cb(this, sim);
      }
    }

    // ----- Startlauf -----
    updateRoll(dt, sim) {
      const dir = U.dirVec(this.hdg);
      this.v += this.T.acc * dt;
      this.x += dir.x * this.v * dt; this.y += dir.y * this.v * dt;
      if (this.v >= U.ktToMs(this.T.vr)) {
        this.mode = 'air'; this.onGround = false;
        sim.onAirborne(this);
      }
    }

    updateAir(dt, sim) {
      const dir = U.dirVec(this.hdg);
      const vt = U.ktToMs(220);
      this.v = Math.min(vt, this.v + 1.2 * dt);
      this.altFt += 2300 / 60 * dt;
      if (this.altFt > 1500 && this.turnTo != null) {
        const d = U.angDiff(this.hdg, this.turnTo);
        this.hdg = (this.hdg + Math.sign(d) * Math.min(Math.abs(d), 2.2 * dt) + 360) % 360;
      }
      this.x += dir.x * this.v * dt; this.y += dir.y * this.v * dt;
      if (Math.hypot(this.x, this.y) > 14000) sim.onDepartureGone(this);
    }

    // ----- Endanflug & Landung -----
    updateFinal(dt, sim) {
      const g = sim.approachGeom(this);
      const remain = this.eta - sim.t;
      const vapp = U.ktToMs(this.T.vapp);
      const d = Math.max(0, remain * vapp);
      this.x = g.aimX + g.sign * d; this.y = g.y; this.hdg = g.hdg;
      this.altFt = Math.max(0, d * Math.tan(U.rad(3)) * 3.28084);
      this.v = vapp;
      this.visible = d < 16000;
      if (remain <= 0) sim.onTouchdown(this);
    }

    updateLanding(dt, sim) {
      const dir = U.dirVec(this.hdg);
      const ex = this.exit;
      const distToExit = Math.abs(ex.x - this.x);
      const vEx = 9;
      const need = Math.max(0.5, (this.v * this.v - vEx * vEx) / (2 * Math.max(1, distToExit - 25)));
      const a = U.clamp(need, 0.6, 3.2);
      this.v = Math.max(vEx, this.v - a * dt);
      const step = Math.min(this.v * dt, distToExit);
      this.x += dir.x * step; this.y += dir.y * step;
      if (distToExit <= 0.5) sim.onReachExit(this);
    }
  }

  ATC.Aircraft = Aircraft;
})(ATC);
