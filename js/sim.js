// Simulation: Flugplan, Pilotenverhalten, KI-Lotsen (Tower/Approach und optional Delivery/Ground),
// Konflikte, Punkte. Enthält keine Grafik – läuft auch ohne Browser (für Tests und später den Server).
(function (ATC) {
  const U = ATC.U, AP = ATC.AP, D = ATC.D, R = ATC.R;

  const POS_ORDER = ['DEL', 'GND', 'TWR', 'APP'];

  class Sim {
    constructor(opts) {
      this.opts = Object.assign({
        seed: Math.floor(Math.random() * 1e9), density: 35, clock0: 7 * 3600, duration: 45 * 60,
        weather: 'random', roles: { DEL: 'player', GND: 'player', TWR: 'ai', APP: 'ai' }, errors: 0.06, tutorial: false
      }, opts || {});
      this.r = U.rng(this.opts.seed);
      this.t = 0;
      this.clock0 = this.opts.clock0;
      this.weather = new ATC.Weather(this.r, this.opts.weather, this.clock0);
      this.list = []; this.byId = {};
      this.log = []; this.logSeq = 0;
      this.score = 0;
      this.stats = { dep: 0, arr: 0, delaySum: 0, delayN: 0, penalties: 0, bonus: 0, goArounds: 0, conflicts: 0 };
      this.standRes = {};               // standId -> callsign (belegt oder reserviert)
      this.squawks = new Set();
      this.usedCs = new Set();
      this.rwy = { N: { occ: null, lastDepT: -999, lastDepWake: 'M', lastArrEta: -999, lastArrWake: 'M' },
                   S: { occ: null, lastDepT: -999, lastDepWake: 'M', lastArrEta: -999, lastArrWake: 'M' } };
      this.outbox = [];                 // verzögerte Funksprüche
      this.pending = [];                // geplante Flüge (noch nicht gespawnt)
      this.over = false; this.overReason = null;
      this.pairPenalty = {};
      this.locks = {};                  // Kreuzungs-Reservierungen: Knoten -> Rufzeichen
      this.vehicles = [];               // Feuerwehr etc. (nur Darstellung)
      this.listeners = [];
      if (this.opts.scenario) this.opts.scenario(this);
      else this.genSchedule();
    }

    get clock() { return this.clock0 + this.t; }
    role(pos) { return (this.opts.roles && this.opts.roles[pos]) || 'ai'; }
    isPlayer(pos) { return this.role(pos) === 'player'; }
    on(fn) { this.listeners.push(fn); }
    emit(ev, data) { for (const f of this.listeners) f(ev, data); }

    // ---------- Funk & Ereignisse ----------
    addLog(entry) {
      entry.id = ++this.logSeq; entry.t = this.t; entry.clock = this.clock;
      this.log.push(entry);
      if (this.log.length > 400) this.log.shift();
      this.emit('log', entry);
    }
    event(kind, text, level) { this.addLog({ from: 'sys', text, level: level || 'info', kind }); }
    // Lotsenspruch (Spieler oder KI)
    atcSay(pos, ac, msg) { this.addLog({ from: this.isPlayer(pos) ? 'atc' : 'ai', pos, freq: D.FREQ[pos], ac: ac && ac.cs, text: msg.text, speech: msg.speech }); }
    // Pilotenspruch, optional verzögert
    pilotSay(ac, msg, delay = 0, pos, guard) {
      const p = pos || ac.freq;
      const item = { at: this.t + delay, fn: () => (!guard || guard()) && this.addLog({ from: 'pilot', pos: p, freq: D.FREQ[p], ac: ac.cs, text: msg.text, speech: msg.speech, seed: ac.seed }) };
      if (delay <= 0) item.fn(); else this.outbox.push(item);
    }
    later(delay, fn) { this.outbox.push({ at: this.t + delay, fn }); }

    addScore(pts, reason, pos, ac) {
      if (pts < 0 && pos && !this.isPlayer(pos)) return; // KI-Fehler kosten keine Punkte
      this.score += pts;
      if (pts < 0) this.stats.penalties += -pts; else this.stats.bonus += pts;
      this.addLog({ from: 'score', text: `${pts > 0 ? '+' : ''}${pts}  ${reason}${ac ? ' (' + ac.cs + ')' : ''}`, level: pts < 0 ? 'bad' : 'good', pos });
    }

    // ---------- Flugplan ----------
    newCallsign(al) {
      for (let i = 0; i < 200; i++) {
        let num;
        const r = this.r();
        if (r < 0.45) num = String(100 + Math.floor(this.r() * 1900));
        else if (r < 0.8) num = String(10 + Math.floor(this.r() * 90));
        else num = String(1 + Math.floor(this.r() * 9)) + String.fromCharCode(65 + Math.floor(this.r() * 26)) + (this.r() < 0.5 ? String.fromCharCode(65 + Math.floor(this.r() * 26)) : '');
        const cs = al.icao + num;
        if (!this.usedCs.has(cs)) { this.usedCs.add(cs); return num; }
      }
      return String(Math.floor(this.r() * 9000) + 1000);
    }
    newSquawk() {
      for (let i = 0; i < 500; i++) {
        let s = String(1 + Math.floor(this.r() * 6));
        for (let k = 0; k < 3; k++) s += String(Math.floor(this.r() * 8));
        if (!this.squawks.has(s) && !['2000', '1000'].includes(s)) { this.squawks.add(s); return s; }
      }
      return '4' + String(Math.floor(this.r() * 512)).padStart(3, '0');
    }

    makeFlight(kind, time, forced) {
      const r = this.r;
      const al = forced && forced.airline ? D.AIRLINES.find(a => a.icao === forced.airline) : U.weighted(r, D.AIRLINES, a => a.w);
      const longHaul = forced && forced.long != null ? forced.long : (al.long.length && r() < al.longShare);
      const type = forced && forced.type ? forced.type : U.pick(r, longHaul ? al.long : (al.fleet.length ? al.fleet : al.long));
      const place = forced && forced.place ? forced.place : (longHaul || D.TYPES[type].wake !== 'M' ? U.pick(r, D.DEST_LONG) : U.pick(r, D.DEST.filter(d => al.leisure ? true : !d.leisure || r() < 0.4)));
      const num = forced && forced.num ? forced.num : this.newCallsign(al);
      const ac = new ATC.Aircraft({
        cs: al.icao + num, airline: al, type, flightNo: num, telephony: al.tel,
        telephonySpoken: al.tel.charAt(0) + al.tel.slice(1).toLowerCase(), kind,
        dest: kind === 'dep' ? place : null, orig: kind === 'arr' ? place : null
      });
      if (kind === 'dep') { ac.eobt = time; ac.state = 'SCHED'; }
      else { ac.eta = time; ac.state = 'SCHED'; }
      return ac;
    }

    genSchedule() {
      const r = this.r, dur = this.opts.duration;
      const perHour = this.opts.density;
      const n = Math.round(perHour * (dur + 10 * 60) / 3600);
      const banks = [U.range(r, 0.15, 0.35) * dur, U.range(r, 0.6, 0.8) * dur];
      const timeIn = (lo, hi) => {
        if (r() < 0.45) { const b = U.pick(r, banks); return U.clamp(b + (r() - 0.5) * 12 * 60, lo, hi); }
        return U.range(r, lo, hi);
      };
      for (let i = 0; i < n; i++) {
        if (r() < 0.5) {
          const eobt = timeIn(4 * 60, dur - 8 * 60);
          this.pending.push({ kind: 'dep', at: Math.max(0, eobt - 22 * 60), ac: this.makeFlight('dep', eobt) });
        } else {
          const eta = timeIn(4 * 60, dur - 4 * 60);
          this.pending.push({ kind: 'arr', at: Math.max(0, eta - 9 * 60), ac: this.makeFlight('arr', eta) });
        }
      }
      // ein paar Flugzeuge stehen zu Beginn schon da und melden sich bald
      for (let i = 0; i < Math.max(2, Math.round(perHour / 12)); i++) {
        const eobt = U.range(r, 5 * 60, 10 * 60);
        this.pending.push({ kind: 'dep', at: 0, ac: this.makeFlight('dep', eobt) });
      }
      this.pending.sort((a, b) => a.at - b.at);
    }

    // Passenden freien Stand finden
    standFits(ac, id) { return AP.stands[id].maxSpan >= ac.T.span; }
    standFree(id, except) { const o = this.standRes[id]; return !o || o === except; }
    pickStand(ac) {
      if (this.forceStand && this.forceStand[ac.cs] && this.standFree(this.forceStand[ac.cs])) return this.forceStand[ac.cs];
      const ids = AP.standIds.filter(id => this.standFits(ac, id) && this.standFree(id));
      if (!ids.length) return null;
      const al = ac.airline;
      const pref = (id) => {
        const st = AP.stands[id];
        let p = 0;
        if (al.cargo) p += st.area === 'Cargo' ? 0 : 50;
        else if (st.area === 'Cargo') p += 80;
        if (!al.cargo) {
          if (al.icao === 'LNX' || al.icao === 'MRX' || al.icao === 'CRV') p += st.area === 'T1' ? 0 : 20;
          else p += st.area === 'T2' ? 0 : 20;
          if (st.area === 'Remote') p += al.regional || al.leisure ? 8 : 30;
        }
        if (st.maxSpan > 70 && ac.T.span < 66) p += 15; // große Stände freihalten
        return p + this.r() * 10;
      };
      ids.sort((a, b) => pref(a) - pref(b));
      return ids[0];
    }

    spawnDeparture(ac) {
      const stand = this.pickStand(ac);
      if (!stand) return false;
      ac.stand = stand; this.standRes[stand] = ac.cs;
      const st = AP.stands[stand];
      const nose = U.dirVec(st.noseHdg);
      ac.x = st.x - nose.x * ac.hl; ac.y = st.y - nose.y * ac.hl; ac.hdg = st.noseHdg;
      ac.visible = true; ac.onGround = true;
      ac.state = 'PRE';
      ac.callAt = Math.max(this.t + U.range(this.r, 10, 40), ac.eobt - U.range(this.r, 9, 14) * 60);
      // Anrufe etwas staffeln, damit nicht alle gleichzeitig auf die Frequenz drängen
      this.lastCallAt = Math.max(ac.callAt, (this.lastCallAt || 0) + U.range(this.r, 25, 50));
      ac.callAt = this.lastCallAt;
      this.addAc(ac);
      return true;
    }

    spawnArrival(ac) {
      ac.stand = this.pickStand(ac);
      if (ac.stand) this.standRes[ac.stand] = ac.cs;
      const st = ac.stand ? AP.stands[ac.stand] : null;
      ac.rwy = this.arrRunwayFor(ac);
      ac.state = 'INB'; ac.freq = 'APP'; ac.onGround = false; ac.visible = false; ac.mode = 'final';
      this.addAc(ac);
      this.sequenceArrival(ac);
      return true;
    }

    // Landebahn passend zur Seite des Standes (kurze Rollwege, Standard-Rollrichtungen)
    arrRunwayFor(ac) {
      const st = ac.stand ? AP.stands[ac.stand] : null;
      const op = this.weather.opDir;
      if (st && (st.side === 'N' || st.side === 'S')) return st.side;
      if (st && st.side === 'W') return op === 27 ? 'N' : 'S';
      if (st && st.side === 'E') return op === 27 ? 'S' : 'N';
      return this.rwy.N.lastArrEta <= this.rwy.S.lastArrEta ? 'N' : 'S';
    }

    sequenceArrival(ac) {
      const rs = this.rwy[ac.rwy];
      const sep = D.WAKE_ARR[rs.lastArrWake][ac.T.wake] + (this.weather.lvp ? 60 : 0);
      ac.eta = Math.max(ac.eta, rs.lastArrEta + sep, this.t + 150);
      rs.lastArrEta = ac.eta; rs.lastArrWake = ac.T.wake;
    }

    addAc(ac) { this.list.push(ac); this.byId[ac.cs] = ac; this.emit('spawn', ac); }
    removeAc(ac) {
      ac.state = 'GONE'; ac.visible = false;
      this.list = this.list.filter(a => a !== ac);
      delete this.byId[ac.cs];
      if (ac.stand && this.standRes[ac.stand] === ac.cs) delete this.standRes[ac.stand];
      if (ac.plan) this.squawks.delete(ac.plan.sq);
      this.emit('remove', ac);
    }

    // ---------- Hauptschleife ----------
    update(dt) {
      if (this.over) return;
      const steps = Math.max(1, Math.ceil(dt / 0.1));
      const h = dt / steps;
      for (let i = 0; i < steps && !this.over; i++) this.step(h);
    }

    step(dt) {
      this.t += dt;
      this.weather.update(dt, this);
      // Flugplan
      while (this.pending.length && this.pending[0].at <= this.t) {
        const p = this.pending.shift();
        const ok = p.kind === 'dep' ? this.spawnDeparture(p.ac) : this.spawnArrival(p.ac);
        if (!ok) { p.at = this.t + 60; this.pending.push(p); this.pending.sort((a, b) => a.at - b.at); break; }
      }
      // verzögerte Funksprüche
      if (this.outbox.length) {
        const due = this.outbox.filter(o => o.at <= this.t);
        if (due.length) {
          this.outbox = this.outbox.filter(o => o.at > this.t);
          due.sort((a, b) => a.at - b.at).forEach(o => o.fn());
        }
      }
      for (const ac of this.list.slice()) this.updateAc(ac, dt);
      this.updateHandoffs();
      this.updateTower(dt);
      // KI-Lotsen entscheiden etwa einmal pro Sekunde
      this.aiTimer = (this.aiTimer || 0) - dt;
      if (this.aiTimer <= 0) {
        this.aiTimer = 1;
        if (!this.isPlayer('DEL')) this.aiDelivery();
        if (!this.isPlayer('GND')) this.aiGround();
      }
      this.checkConflicts(dt);
      this.cleanLocks();
      this.updateVehicles(dt);
      if (this.t >= this.opts.duration && !this.opts.tutorial) this.endShift('Schichtende');
    }

    cleanLocks() {
      for (const n in this.locks) {
        const a = this.byId[this.locks[n]];
        if (!a || a.mode !== 'path' || !a.routeNodes || !a.routeNodes.includes(n)) delete this.locks[n];
      }
    }

    endShift(reason) {
      if (this.over) return;
      this.over = true; this.overReason = reason;
      this.emit('over', reason);
    }

    updateAc(ac, dt) {
      // Bewegung
      if (ac.mode === 'path') ac.updatePath(dt, this);
      else if (ac.mode === 'roll') ac.updateRoll(dt, this);
      else if (ac.mode === 'air') ac.updateAir(dt, this);
      else if (ac.mode === 'final' && (ac.state === 'FINAL' || ac.state === 'INB')) {
        if (ac.state === 'INB' && ac.eta - this.t < 330) {
          ac.state = 'FINAL'; ac.freq = 'TWR';
        }
        if (ac.state === 'FINAL') ac.updateFinal(dt, this);
        if (ac.state === 'FINAL' && !ac.flags.landClr && ac.eta - this.t < 120) {
          ac.flags.landClr = true;
          this.atcSay('TWR', ac, R.atc.landing(this, ac));
        }
      } else if (ac.mode === 'land') ac.updateLanding(dt, this);

      // Pilotenverhalten nach Zustand
      switch (ac.state) {
        case 'PRE':
          if (this.t >= ac.callAt) {
            ac.freq = 'DEL'; ac.state = 'CLR_REQ';
            let letter = this.weather.letter;
            if (this.r() < 0.06) letter = String.fromCharCode(65 + ((this.weather.letterIdx + 25) % 26));
            ac.reportedAtis = letter;
            this.request(ac, 'DEL', R.pilot.clrRequest(this, ac, letter));
          }
          break;
        case 'GND_WAIT':
          if (this.t >= ac.readyAt) {
            ac.state = 'PB_REQ';
            this.request(ac, 'GND', R.pilot.pushRequest(ac));
          }
          break;
        case 'PB_HOLD':
          if (this.t >= ac.pbExpect) { ac.state = 'PB_REQ'; this.request(ac, 'GND', R.pilot.pushRequest(ac)); }
          break;
        case 'PUSHING':
          if (ac.mode !== 'path' && this.t >= ac.tugAt) this.startPushMove(ac);
          break;
        case 'STARTUP':
          if (this.t >= ac.startupEnd) {
            if (!ac.flags.emergChecked) {
              ac.flags.emergChecked = true;
              if (this.r() < this.opts.errors * 0.12) { this.emergencyEngineFire(ac); break; }
            }
            ac.state = 'TAXI_REQ';
            this.request(ac, 'GND', R.pilot.readyTaxi(ac));
          }
          break;
        case 'TOW_WAIT':
          if (this.t >= ac.towAt) this.finishTow(ac);
          break;
        case 'EMERG':
          if (this.t >= ac.emergUntil) this.endEmergency(ac);
          break;
        case 'PARKED':
          if (this.t >= ac.parkedUntil) {
            if (ac.kind === 'arr') { this.stats.arr++; this.addScore(10, 'Ankunft sicher am Stand', 'GND', ac); }
            this.removeAc(ac);
          }
          break;
      }
      // Wartezeit / wiederholte Anrufe
      if (ac.waitSince != null && !this.over) {
        const w = this.t - ac.waitSince;
        if (w > 75 && ac.calls === 1 && ac.lastMsg) {
          ac.calls = 2;
          this.pilotSay(ac, R.pilot.secondCall(ac.lastMsg), 0, ac.waitRole);
        }
        if (w > 90 && !this.opts.tutorial) {
          const k = Math.floor((w - 90) / 30) + 1;
          if (k > (ac.waitPenK || 0)) { ac.waitPenK = k; this.addScore(-2, 'Wartezeit ohne Antwort', ac.waitRole, ac); }
        }
      }
    }

    // Pilot ruft an und wartet auf Antwort
    request(ac, pos, msg, delay = 0) {
      ac.waitSince = this.t + delay; ac.waitRole = pos; ac.calls = 1; ac.lastMsg = msg; ac.waitPenK = 0;
      const tok = ac.reqTok = (ac.reqTok || 0) + 1;
      // Anruf entfällt, wenn der Lotse schon vorher reagiert hat
      this.pilotSay(ac, msg, delay, pos, () => ac.reqTok === tok && ac.waitSince != null);
      this.emit('request', ac);
    }
    answered(ac) { ac.waitSince = null; ac.calls = 0; ac.lastMsg = null; ac.reqTok = (ac.reqTok || 0) + 1; }

    // ---------- Übergaben ----------
    offerHandoff(ac, from, to, after) {
      ac.handoff = { from, to, t: this.t, after };
      const auto = !this.isPlayer(to) || (this.isPlayer(from) && this.isPlayer(to) && this.opts.autoAcceptOwn !== false);
      if (auto) ac.handoff.autoAt = this.t + (this.isPlayer(to) ? 0.5 : U.range(this.r, 2, 5));
      else { ac.waitSince = this.t; ac.waitRole = to; ac.calls = 0; ac.lastMsg = null; ac.waitPenK = 0; }
      this.emit('handoff', ac);
    }
    acceptHandoff(ac, by) {
      const h = ac.handoff;
      if (!h) return { ok: false, msg: 'Keine Übergabe offen.' };
      if (by && by !== h.to) return { ok: false, msg: 'Diese Übergabe geht an ' + D.ROLE_NAME[h.to] + '.' };
      ac.handoff = null;
      ac.freq = h.to;
      this.answered(ac);
      if (h.after) h.after(ac);
      return { ok: true };
    }
    updateHandoffs() {
      for (const ac of this.list) if (ac.handoff && ac.handoff.autoAt != null && this.t >= ac.handoff.autoAt) this.acceptHandoff(ac);
    }

    // ---------- Delivery ----------
    defaultClearance(ac) {
      const opDir = this.weather.opDir;
      return { sid: D.sidFor(ac.dest.dir, opDir), alt: D.SID_ALT[ac.dest.dir], sq: (ac.plan && ac.plan.sq) || this.newSquawk() };
    }

    cmdClearance(ac, p = {}) {
      if (ac.kind !== 'dep') return { ok: false, msg: 'Nur Abflüge brauchen eine Streckenfreigabe.' };
      const okStates = ['CLR_REQ', 'CLR_RB', 'CLEARED', 'GND_WAIT', 'PB_REQ', 'PB_HOLD', 'PUSHING', 'STARTUP', 'TAXI_REQ', 'TAXI', 'AT_HP'];
      if (!okStates.includes(ac.state)) return { ok: false, msg: ac.cs + ' kann jetzt keine Freigabe erhalten.' };
      const revised = !!ac.plan && ac.state !== 'CLR_REQ' && ac.state !== 'CLR_RB';
      if (revised && ac.freq === 'DEL' && ac.state === 'CLEARED') { /* einfache Korrektur */ }
      const def = this.defaultClearance(ac);
      const c = { sid: (p.sid || def.sid).toUpperCase().replace(/\s/g, ''), alt: p.alt || def.alt, sq: p.sq || (ac.plan ? ac.plan.sq : def.sq) };
      if (!/^[A-Z]{5}\d[A-Z]$/.test(c.sid)) return { ok: false, msg: 'SID-Format: z. B. ROKAT1W' };
      if (!/^[0-7]{4}$/.test(c.sq)) return { ok: false, msg: 'Squawk muss aus 4 Ziffern 0–7 bestehen.' };
      if (c.sq !== def.sq && ac.plan && c.sq !== ac.plan.sq) this.squawks.add(c.sq);
      const pos = 'DEL';
      const sayPos = revised && ac.freq !== 'DEL' ? ac.freq : pos;
      this.atcSay(sayPos, ac, R.atc.clearance(ac, c, revised));
      ac.plan = c;
      ac.flags.badSid = false;
      // Readback mit möglichem Fehler
      const read = Object.assign({}, c);
      const errP = this.opts.errors * (ac.rbErrors ? 0.3 : 1);
      if (this.r() < errP) {
        ac.rbErrors = (ac.rbErrors || 0) + 1;
        const f = U.pick(this.r, ['sq', 'sq', 'alt', 'sid']);
        if (f === 'sq') { const d = c.sq.split(''); const i = 1 + Math.floor(this.r() * 3); const j = i === 3 ? 2 : i + 1; [d[i], d[j]] = [d[j], d[i]]; if (d.join('') === c.sq) d[3] = String((+d[3] + 1) % 8); read.sq = d.join(''); }
        else if (f === 'alt') read.alt = c.alt === 5000 ? 6000 : 5000;
        else read.sid = c.sid.replace(/\d/, (m) => String((+m % 9) + 1));
      }
      ac.pilotPlan = read;
      ac.rbPending = true;
      if (ac.state === 'CLR_REQ') ac.state = 'CLR_RB';
      if (ac.freq === 'DEL') this.answered(ac);
      this.pilotSay(ac, R.pilot.clrReadback(ac, read, revised), U.range(this.r, 1.8, 3.2), sayPos);
      if (revised && ac.state === 'TAXI_REQ' && ac.flags.waitingRevised) { ac.flags.waitingRevised = false; }
      return { ok: true };
    }

    cmdReadbackCorrect(ac) {
      if (!ac.rbPending) return { ok: false, msg: 'Kein offenes Readback.' };
      this.atcSay(ac.freq === 'DEL' ? 'DEL' : ac.freq, ac, R.atc.rbc(ac));
      this.confirmReadback(ac);
      return { ok: true };
    }
    confirmReadback(ac) {
      ac.rbPending = false;
      const wrong = ac.pilotPlan && (ac.pilotPlan.sq !== ac.plan.sq || ac.pilotPlan.alt !== ac.plan.alt || ac.pilotPlan.sid !== ac.plan.sid);
      ac.rbWrongAccepted = !!wrong;
      if (ac.state === 'CLR_RB') ac.state = 'CLEARED';
      if (ac.freq === 'DEL') this.answered(ac);
    }

    cmdContactGround(ac) {
      if (ac.freq !== 'DEL') return { ok: false, msg: ac.cs + ' ist nicht auf Delivery.' };
      if (!ac.plan) return { ok: false, msg: 'Erst die Streckenfreigabe erteilen.' };
      if (ac.rbPending) this.confirmReadback(ac);
      this.atcSay('DEL', ac, R.atc.contact(ac, 'GND'));
      this.pilotSay(ac, R.pilot.freqReadback(ac, 'GND'), U.range(this.r, 1.2, 2.2), 'DEL');
      ac.freq = null;
      this.offerHandoff(ac, 'DEL', 'GND', (a) => {
        a.state = 'GND_WAIT';
        a.readyAt = Math.max(this.t + U.range(this.r, 15, 40), a.eobt - 90 + U.range(this.r, -60, 90));
      });
      return { ok: true };
    }

    // ---------- Ground: Pushback ----------
    pushOptions(ac) {
      const st = AP.stands[ac.stand];
      if (!st) return [];
      const L = st.laneNode;
      const opts = [];
      for (const ei of AP.adj[L]) {
        const e = AP.edges[ei];
        if (e.kind === 'stand') continue;
        const nb = AP.other(e, L);
        const facing = AP.dirBetween(nb, L);
        opts.push({ facing, back: nb, lane: L, word: U.P.hdgWord(facing) });
      }
      return opts;
    }

    cmdPushback(ac, facingWord) {
      if (!['PB_REQ', 'PB_HOLD'].includes(ac.state)) return { ok: false, msg: ac.cs + ' hat keinen Pushback angefragt.' };
      const opts = this.pushOptions(ac);
      let o = null;
      if (facingWord) {
        const w = { N: 'north', E: 'east', S: 'south', W: 'west' }[facingWord[0].toUpperCase()];
        o = opts.find(x => x.word === w);
        if (!o) return { ok: false, msg: 'Pushback-Richtung nicht möglich. Möglich: ' + opts.map(x => x.word[0].toUpperCase()).join('/') };
      } else o = opts[0];
      this.atcSay('GND', ac, R.atc.push(ac, o.facing));
      this.pilotSay(ac, R.pilot.pushReadback(ac, o.facing), U.range(this.r, 1.5, 2.8), 'GND');
      this.answered(ac);
      ac.state = 'PUSHING'; ac.push = o; ac.tugAt = this.t + U.range(this.r, 12, 25);
      return { ok: true };
    }

    cmdPushHold(ac, mins) {
      if (ac.state !== 'PB_REQ') return { ok: false, msg: 'Kein offener Pushback-Wunsch.' };
      mins = U.clamp(Math.round(mins || 2), 1, 15);
      this.atcSay('GND', ac, R.atc.pushHold(ac, mins));
      this.pilotSay(ac, R.pilot.pushHoldReadback(ac, mins), U.range(this.r, 1.5, 2.5), 'GND');
      this.answered(ac);
      ac.state = 'PB_HOLD'; ac.pbExpect = this.t + mins * 60 + U.range(this.r, 10, 40);
      return { ok: true };
    }

    startPushMove(ac) {
      const o = ac.push, L = AP.nodes[o.lane], B = AP.nodes[o.back];
      const st = AP.stands[ac.stand];
      const pushDir = U.dirVec(U.hdgOf(L.x - st.x, L.y - st.y));
      const F = U.dirVec(o.facing);
      const end = { x: L.x - F.x * 70, y: L.y - F.y * 70 };
      const path = AP.buildPath([{ x: ac.x, y: ac.y }, { x: L.x, y: L.y, node: o.lane }, end], 34);
      ac.path = path; ac.s = 0; ac.reverse = true; ac.mode = 'path';
      ac.endS = path.len; ac.maxV = 1.6; ac.routeNodes = null; ac.lookahead = 25;
      ac.flags.pushing = true;
      ac.onPathEnd = (a) => {
        if (this.standRes[a.stand] === a.cs) delete this.standRes[a.stand]; // Stand ist jetzt frei
        a.mode = null; a.path = null; a.reverse = false; a.maxV = null; a.lookahead = null; a.flags.pushing = false;
        a.edgeHint = { from: o.back, to: o.lane };
        a.state = 'STARTUP'; a.startupEnd = this.t + U.range(this.r, 25, 70);
      };
      void pushDir; void B;
    }

    // ---------- Ground: Rollen ----------
    parseDest(name) {
      name = String(name).toUpperCase();
      if (AP.hps[name]) return { type: 'hp', name, node: AP.hps[name].node };
      if (AP.stands[name]) return { type: 'stand', name, node: AP.stands[name].node };
      return null;
    }

    cmdTaxi(ac, destName, via, silentErrors, allowRev) {
      const pos = 'GND';
      const okStates = ac.kind === 'dep' ? ['TAXI_REQ', 'TAXI', 'AT_HP'] : ['ARR_TX_REQ', 'TAXI', 'VACATING'];
      if (ac.flags.returnToStand) okStates.push('TAXI', 'AT_HP');
      if (!okStates.includes(ac.state)) return { ok: false, msg: ac.cs + ' ist nicht rollbereit.' };
      if (ac.freq !== 'GND') return { ok: false, msg: ac.cs + ' ist nicht auf Ground.' };
      let dest = destName ? this.parseDest(destName) : null;
      if (!dest && ac.kind === 'arr' && ac.stand) dest = this.parseDest(ac.stand);
      if (!dest) return { ok: false, msg: 'Unbekanntes Ziel. Holding Point (z. B. N8) oder Stand (z. B. 104).' };
      if (ac.kind === 'dep' && !ac.flags.returnToStand && dest.type !== 'hp') return { ok: false, msg: 'Abflüge rollen zu einem Holding Point.' };
      if ((ac.kind === 'arr' || ac.flags.returnToStand) && dest.type !== 'stand') return { ok: false, msg: 'Dieses Flugzeug rollt zu einem Stand.' };
      via = (via || []).map(v => v.toUpperCase()).filter(Boolean);
      const bad = via.find(v => !AP.twyNames.includes(v));
      if (bad) return { ok: false, msg: 'Unbekannter Rollweg: ' + bad };

      const start = ac.routeStart();
      if (!start) return { ok: false, msg: 'Position unklar.' };
      const fopt = { flow: this.weather.opDir, allowReverse: !!allowRev };
      let route = AP.findRoute(start.from != null ? { from: start.from, to: start.to } : start, dest.node, via.length ? via : null, fopt);
      let needTow = !!(route && route.reversed);
      if (!route) {
        const r2 = AP.findRoute(start.from != null ? { from: start.from, to: start.to } : start, dest.node, via.length ? via : null, { allowReverse: true, flow: this.weather.opDir });
        if (r2 && r2.reversed) { route = r2; needTow = true; }
      }
      const autoVia = route ? AP.viaFromNames(route.names, start.from != null ? (AP.edgeBetween(start.from, start.to) || {}).name : null, dest.node) : via;
      const sayVia = via.length ? via : autoVia;
      this.atcSay(pos, ac, R.atc.taxi(this, ac, dest, sayVia));
      this.answered(ac);
      const delay = U.range(this.r, 1.6, 3.0);
      if (ac.rbTaxiErr) ac.rbTaxiErr = null; // korrigiert
      ac.flags.needReroute = false;

      // Plausibilitätsprüfungen der Piloten
      if (dest.type === 'hp') {
        const hp = AP.hps[dest.name];
        if (!this.hpValidNow(dest.name)) {
          this.pilotSay(ac, R.pilot.confirmHp(this, ac, dest.name), delay, pos);
          ac.waitSince = this.t + delay; ac.waitRole = pos; ac.calls = 1;
          return { ok: true, note: 'Pilot fragt nach' };
        }
        if (hp.tora[this.weather.opDir] < ac.T.tora) {
          this.pilotSay(ac, R.pilot.unableIntersection(ac, dest.name), delay, pos);
          ac.waitSince = this.t + delay; ac.waitRole = pos; ac.calls = 1;
          return { ok: true, note: 'Bahnlänge reicht nicht' };
        }
      } else {
        if (!this.standFits(ac, dest.name)) {
          this.pilotSay(ac, R.pilot.standUnsuitable(ac, dest.name), delay, pos);
          ac.waitSince = this.t + delay; ac.waitRole = pos; ac.calls = 1;
          return { ok: true };
        }
        if (!this.standFree(dest.name, ac.cs)) {
          this.pilotSay(ac, R.pilot.standOccupied(ac, dest.name), delay, pos);
          ac.waitSince = this.t + delay; ac.waitRole = pos; ac.calls = 1;
          return { ok: true };
        }
      }
      if (!route) {
        this.pilotSay(ac, R.pilot.unableRoute(ac), delay, pos);
        ac.waitSince = this.t + delay; ac.waitRole = pos; ac.calls = 1;
        return { ok: true, note: 'Route nicht fahrbar' };
      }
      // Stand reservieren
      if (dest.type === 'stand') {
        if (ac.stand && ac.stand !== dest.name && this.standRes[ac.stand] === ac.cs) delete this.standRes[ac.stand];
        ac.stand = dest.name; this.standRes[dest.name] = ac.cs;
      }

      // Readback-Fehler: Pilot versteht einen Rollweg falsch
      let followRoute = route, readVia = sayVia;
      if (!needTow && via.length >= 2 && this.r() < this.opts.errors * 0.7 && !silentErrors) {
        const alt = this.wrongVia(start, dest, via, route);
        if (alt) { followRoute = alt.route; readVia = alt.via; ac.rbTaxiErr = { deadline: this.t + delay + 25 }; }
      }
      this.pilotSay(ac, R.pilot.taxiReadback(this, ac, dest, readVia), delay, pos);

      ac.taxiDest = dest;
      ac.clearInstructions();
      if (ac.state !== 'TAXI') ac.state = 'TAXI';
      if (needTow) {
        this.pilotSay(ac, R.pilot.needTow(ac), delay + 3, pos);
        this.addScore(-15, 'Schlepper nötig (Flugzeug kann nicht wenden)', pos, ac);
        ac.state = 'TOW_WAIT'; ac.towAt = this.t + 75; ac.towRoute = followRoute; ac.mode = null; ac.v = 0;
        return { ok: true };
      }
      this.applyTaxiRoute(ac, followRoute, dest);
      return { ok: true };
    }

    wrongVia(start, dest, via, route) {
      const st = start.from != null ? { from: start.from, to: start.to } : start;
      for (let tries = 0; tries < 12; tries++) {
        const i = Math.floor(this.r() * via.length);
        const cand = U.pick(this.r, AP.twyNames.filter(n => n !== via[i] && !/^[NS]\d$/.test(n)));
        const v2 = via.slice(); v2[i] = cand;
        const r2 = AP.findRoute(st, dest.node, v2);
        if (r2 && r2.nodes.join() !== route.nodes.join()) return { route: r2, via: v2 };
      }
      return null;
    }

    applyTaxiRoute(ac, route, dest) {
      // Seltener Pilotenfehler: falsch abbiegen
      let nodes = route.nodes.slice();
      ac.flags.missedTurn = false;
      if (this.r() < this.opts.errors * 0.25 && nodes.length > 5) {
        for (let tries = 0; tries < 6; tries++) {
          const j = 2 + Math.floor(this.r() * (nodes.length - 4));
          const prev = nodes[j - 1], cur = nodes[j], next = nodes[j + 1];
          const inH = AP.dirBetween(prev, cur);
          const alts = AP.adj[cur].map(ei => AP.edges[ei]).filter(e => (e.kind === 'twy' || e.kind === 'lane'))
            .filter(e => !e.glue && AP.flowOf(e, cur, AP.other(e, cur), this.weather.opDir) !== false).map(e => AP.other(e, cur)).filter(n => n !== prev && n !== next && Math.abs(U.angDiff(inH, AP.dirBetween(cur, n))) <= 95);
          if (alts.length) { nodes = nodes.slice(0, j + 1).concat([U.pick(this.r, alts)]); ac.flags.missedTurn = true; break; }
        }
      }
      ac.setRoute({ nodes }, {
        noseStop: ac.flags.missedTurn ? 30 : 0,
        onEnd: (a) => this.onTaxiEnd(a)
      });
      if (dest.type === 'hp') ac.endS = Math.max(0, ac.path.len - ac.hl);
    }

    onTaxiEnd(ac) {
      if (ac.flags.missedTurn) {
        ac.flags.missedTurn = false;
        ac.flags.needReroute = true;
        if (ac.freq === 'GND') this.request(ac, 'GND', R.pilot.missedTurn(ac), 1);
        else {
          // war schon bei Tower: Tower schickt das Flugzeug zurück zu Ground
          const from = ac.freq || 'TWR';
          ac.freq = null; ac.handoff = null;
          this.offerHandoff(ac, from, 'GND', (a) => this.request(a, 'GND', R.pilot.missedTurn(a), 1));
        }
        return;
      }
      const d = ac.taxiDest;
      if (!d) return;
      if (d.type === 'stand') {
        ac.state = 'PARKED'; ac.mode = null; ac.v = 0;
        ac.parkedUntil = this.t + (ac.flags.returnToStand ? 40 : 75);
        if (ac.flags.returnToStand) {
          this.addLog({ from: 'sys', text: `${ac.cs} ist zurück am Stand – Flug annulliert.`, level: 'info' });
          this.addScore(5, 'Notfall sauber abgewickelt', 'GND', ac);
          ac.kind = 'done';
        }
        return;
      }
      // Holding Point erreicht
      ac.state = ac.freq === 'TWR' ? 'TWR_HOLD' : 'AT_HP';
      ac.hpAt = this.t;
      ac.mode = null; ac.v = 0;
      if (ac.state === 'AT_HP' && !ac.handoff) this.request(ac, 'GND', R.pilot.atHp(this, ac), 1);
    }

    finishTow(ac) {
      // Schlepper dreht das Flugzeug, danach rollt es selbst
      const route = ac.towRoute;
      ac.towRoute = null;
      ac.state = 'TAXI';
      // neue Position: Start der umgekehrten Route
      const first = route.nodes[1];
      ac.hdg = AP.dirBetween(route.nodes[0], first);
      ac.setRoute(route, { onEnd: (a) => this.onTaxiEnd(a) });
      if (ac.taxiDest && ac.taxiDest.type === 'hp') ac.endS = Math.max(0, ac.path.len - ac.hl);
      else ac.endS = Math.max(0, ac.path.len - ac.hl);
    }

    cmdHold(ac) {
      if (ac.freq !== 'GND') return { ok: false, msg: ac.cs + ' ist nicht auf Ground.' };
      this.atcSay('GND', ac, R.atc.hold(ac));
      this.pilotSay(ac, R.pilot.holdReadback(ac), U.range(this.r, 1.2, 2.2), 'GND');
      ac.holdPos = true;
      return { ok: true };
    }
    cmdContinue(ac) {
      if (ac.freq !== 'GND') return { ok: false, msg: ac.cs + ' ist nicht auf Ground.' };
      this.atcSay('GND', ac, R.atc.cont(ac));
      this.pilotSay(ac, R.pilot.contReadback(ac), U.range(this.r, 1.2, 2.2), 'GND');
      ac.clearInstructions();
      if (ac.waitRole === 'GND' && ac.flags.blockedCall) { ac.flags.blockedCall = false; this.answered(ac); }
      return { ok: true };
    }
    cmdHoldShort(ac, twy) {
      if (ac.freq !== 'GND') return { ok: false, msg: ac.cs + ' ist nicht auf Ground.' };
      if (!ac.path || ac.mode !== 'path') return { ok: false, msg: ac.cs + ' rollt gerade nicht.' };
      twy = String(twy).toUpperCase();
      this.atcSay('GND', ac, R.atc.holdShort(ac, twy));
      // erster Knoten der Route, an dem der Rollweg kreuzt/abzweigt (nicht der aktuelle)
      const curEdge = ac.routeStart();
      const curName = curEdge && curEdge.from != null ? (AP.edgeBetween(curEdge.from, curEdge.to) || {}).name : null;
      const rem = ac.remainingNodes();
      let target = null;
      for (const n of rem) {
        if (AP.namesOfNode(n).includes(twy) && curName !== twy) { target = n; break; }
      }
      if (!target) {
        this.pilotSay(ac, R.pilot.notOnRoute(ac, twy), U.range(this.r, 1.5, 2.5), 'GND');
        return { ok: true };
      }
      ac.holdShort = { name: twy, node: target, s: ac.path.nodeS[target] - 32 - ac.hl - AP.geo.twyWidth / 2 };
      this.pilotSay(ac, R.pilot.holdShortReadback(ac, twy), U.range(this.r, 1.2, 2.2), 'GND');
      return { ok: true };
    }
    relDesc(ac, o) {
      const b = U.hdgOf(o.x - ac.x, o.y - ac.y);
      const rel = U.angDiff(ac.hdg, b);
      const oh = U.angDiff(ac.hdg, o.hdg);
      if (Math.abs(oh) > 140) return 'opposite direction';
      if (Math.abs(rel) < 35 && Math.abs(oh) < 40) return 'ahead';
      return rel < 0 ? 'from the left' : 'from the right';
    }
    cmdGiveWay(ac, other, follow) {
      if (ac.freq !== 'GND') return { ok: false, msg: ac.cs + ' ist nicht auf Ground.' };
      const o = this.findAc(other);
      if (!o || o === ac) return { ok: false, msg: 'Unbekanntes Flugzeug: ' + other };
      if (follow) this.atcSay('GND', ac, R.atc.follow(ac, o));
      else this.atcSay('GND', ac, R.atc.giveWay(ac, o, this.relDesc(ac, o)));
      const mine = ac.remainingNodes();
      const theirs = new Set(o.mode === 'path' ? o.remainingNodes() : []);
      // gemeinsamen Knoten finden; sonst Knoten nahe der Position des anderen
      let node = mine.find(n => theirs.has(n));
      if (!node) node = mine.find(n => U.dist(AP.nodes[n].x, AP.nodes[n].y, o.x, o.y) < 60);
      if (node) ac.giveWay = { target: o.cs, node };
      if (follow) ac.follow = o.cs;
      this.pilotSay(ac, follow ? R.pilot.followReadback(ac, o) : R.pilot.giveWayReadback(ac, o), U.range(this.r, 1.4, 2.4), 'GND');
      return { ok: true };
    }
    cmdStand(ac, standId) {
      if (ac.kind !== 'arr') return { ok: false, msg: 'Standzuweisung nur für Ankünfte.' };
      standId = String(standId).toUpperCase();
      if (!AP.stands[standId]) return { ok: false, msg: 'Unbekannter Stand.' };
      if (!this.standFits(ac, standId)) return { ok: false, msg: `Stand ${standId} ist zu klein für ${ac.type}.` };
      if (!this.standFree(standId, ac.cs)) return { ok: false, msg: `Stand ${standId} ist belegt.` };
      const pos = ac.freq === 'GND' ? 'GND' : null;
      if (ac.stand && this.standRes[ac.stand] === ac.cs) delete this.standRes[ac.stand];
      ac.stand = standId; this.standRes[standId] = ac.cs;
      if (pos) {
        this.atcSay('GND', ac, R.atc.stand(ac, standId));
        this.pilotSay(ac, R.pilot.standReadback(ac, standId), U.range(this.r, 1.3, 2.2), 'GND');
        if (ac.state === 'TAXI' && ac.taxiDest && ac.taxiDest.type === 'stand') { ac.holdPos = true; this.request(ac, 'GND', R.pilot.unableRoute(ac), 3); }
      } else this.event('info', `${ac.cs}: Stand ${standId} zugewiesen.`);
      return { ok: true };
    }
    cmdContactTower(ac) {
      if (ac.freq !== 'GND') return { ok: false, msg: ac.cs + ' ist nicht auf Ground.' };
      if (ac.kind !== 'dep' || !ac.taxiDest || ac.taxiDest.type !== 'hp' || !['TAXI', 'AT_HP'].includes(ac.state))
        return { ok: false, msg: 'Übergabe an Tower erst, wenn der Abflug zum Holding Point rollt.' };
      this.atcSay('GND', ac, R.atc.contact(ac, 'TWR'));
      this.pilotSay(ac, R.pilot.freqReadback(ac, 'TWR'), U.range(this.r, 1.2, 2.2), 'GND');
      this.answered(ac);
      ac.freq = null;
      this.offerHandoff(ac, 'GND', 'TWR', (a) => {
        if (a.state === 'AT_HP') { a.state = 'TWR_HOLD'; if (a.hpAt == null) a.hpAt = this.t; }
      });
      return { ok: true };
    }

    findAc(q) {
      if (!q) return null;
      q = String(q).toUpperCase().replace(/\s/g, '');
      if (this.byId[q]) return this.byId[q];
      const m = this.list.filter(a => a.cs.endsWith(q) || a.cs.includes(q));
      return m.length === 1 ? m[0] : (m.find(a => a.flightNo === q) || null);
    }

    // Holding Point gültig? Nach einem Betriebsrichtungswechsel dürfen Flugzeuge 10 Minuten lang
    // noch in die alte Richtung starten (Übergangsphase, wie in der Realität mit etwas Rückenwind).
    hpValidNow(name) {
      const hp = AP.hps[name], w = this.weather;
      if (!hp || hp.depFor == null) return false;
      return hp.depFor === w.opDir || (hp.depFor === w.prevOpDir && this.t < w.changedAt + 600);
    }

    // ---------- Tower / Approach (KI in Etappe 1) ----------
    approachGeom(ac) {
      const op = this.weather.opDir;
      const sign = op === 27 ? 1 : -1;     // Anflug aus Osten bei 27
      const thrX = sign * AP.geo.rwyHalfLen;
      return { y: AP.runways[ac.rwy].y, sign, thrX, aimX: thrX - sign * 400, hdg: op === 27 ? 270 : 90 };
    }

    updateTower(dt) {
      const op = this.weather.opDir;
      for (const rwId of ['N', 'S']) {
        const rs = this.rwy[rwId];
        // Belegung prüfen
        if (rs.occ) {
          const o = this.byId[rs.occ];
          if (!o || o.state === 'GONE' || o.state === 'AIR' || (o.flags.vacatedRwy)) rs.occ = null;
        }
        const arrivals = this.list.filter(a => a.kind === 'arr' && a.rwy === rwId && (a.state === 'FINAL' || a.state === 'INB')).sort((a, b) => a.eta - b.eta);
        const next = arrivals[0];
        // Go-around falls Bahn belegt
        if (next && next.state === 'FINAL' && next.eta - this.t < 20 && rs.occ && rs.occ !== next.cs) {
          const occ = this.byId[rs.occ];
          this.atcSay('TWR', next, R.atc.goAround(next));
          this.stats.goArounds++;
          next.flags.landClr = false;
          next.eta = Math.max(this.t + 420, rs.lastArrEta + D.WAKE_ARR[rs.lastArrWake][next.T.wake] + 30);
          rs.lastArrEta = next.eta; rs.lastArrWake = next.T.wake;
          if (occ && occ.kind === 'arr' && occ.state === 'VACATING') this.addScore(-40, 'Go-around: Bahnausfahrt blockiert', 'GND', occ);
          else this.event('info', `${next.cs} startet durch (Bahn belegt).`);
        }
        if (rs.occ) continue;
        const tA = next ? next.eta - this.t : Infinity;
        // Abflüge in der Reihenfolge der Ankunft am Holding Point
        const queue = this.list.filter(a => a.state === 'TWR_HOLD' && AP.hps[a.taxiDest.name].rwy === rwId).sort((a, b) => a.hpAt - b.hpAt);
        const cand = queue[0];
        if (!cand) continue;
        if (!cand.flags.twrChecked) {
          cand.flags.twrChecked = true;
          const hpOk = this.hpValidNow(cand.taxiDest.name);
          const sidOk = D.sidMatches(cand.pilotPlan && cand.pilotPlan.sid, AP.hps[cand.taxiDest.name].depFor || op);
          if (!hpOk || !sidOk) { this.towerRejects(cand, hpOk, sidOk); continue; }
        }
        const gap = D.WAKE_DEP[rs.lastDepWake][cand.T.wake];
        const sinceDep = this.t - rs.lastDepT;
        const need = 75 + U.ktToMs(cand.T.vr) / cand.T.acc + (this.weather.lvp ? 45 : 0);
        if (tA > need && sinceDep >= gap - 40) this.startLineup(cand, rwId, gap - sinceDep);
      }
    }

    towerRejects(ac, hpOk, sidOk) {
      ac.state = 'AT_HP'; ac.flags.twrChecked = false;
      ac.freq = null;
      this.offerHandoff(ac, 'TWR', 'GND', (a) => {
        if (!sidOk) {
          a.flags.waitingRevised = true;
          this.request(a, 'GND', R.pilot.wrongSid(a), 1);
        } else this.request(a, 'GND', R.pilot.wrongHp(this, a), 1);
      });
      if (!hpOk) this.addScore(-20, 'Falscher Holding Point für die Betriebsrichtung', 'GND', ac);
      if (!sidOk) this.addScore(-15, 'SID passt nicht zur Betriebsrichtung', 'DEL', ac);
    }

    startLineup(ac, rwId, waitMore) {
      const rs = this.rwy[rwId];
      rs.occ = ac.cs;
      const hp = AP.hps[ac.taxiDest.name];
      const op = hp.depFor || this.weather.opDir;   // Startrichtung = Richtung des Holding Points
      const rn = AP.nodes[`R_${hp.name}`];
      const dir = op === 27 ? -1 : 1;
      const end = { x: rn.x + dir * 70, y: rn.y };
      ac.path = AP.buildPath([{ x: ac.x, y: ac.y }, { x: rn.x, y: rn.y, node: rn.id }, end], 45);
      ac.s = 0; ac.reverse = false; ac.mode = 'path'; ac.endS = ac.path.len; ac.maxV = 6; ac.routeNodes = null; ac.lookahead = 0;
      ac.state = 'LINEUP';
      const immediate = waitMore <= 15;
      this.atcSay('TWR', ac, immediate ? R.atc.takeoff(this, ac) : R.atc.lineup(this, ac));
      ac.toAt = this.t + Math.max(0, waitMore);
      ac.onPathEnd = (a) => {
        a.mode = null; a.maxV = null; a.lookahead = null;
        const go = () => {
          if (!immediate) this.atcSay('TWR', a, R.atc.takeoff(this, a));
          a.state = 'TAKEOFF'; a.mode = 'roll'; a.hdg = op === 27 ? 270 : 90; a.v = Math.max(a.v, 1);
          rs.lastDepT = this.t; rs.lastDepWake = a.T.wake;
          this.stats.delaySum += Math.max(0, this.t - (a.eobt + 12 * 60)); this.stats.delayN++;
        };
        const wait = Math.max(0, a.toAt - this.t);
        if (wait < 1) go(); else this.later(wait, go);
      };
    }

    onAirborne(ac) {
      ac.state = 'AIR';
      const rs = this.rwy[AP.hps[ac.taxiDest.name].rwy];
      if (rs.occ === ac.cs) rs.occ = null;
      const dirHdg = { W: 270, N: 0, E: 90, S: 180 }[ac.dest.dir];
      ac.turnTo = dirHdg;
      if (ac.rbWrongAccepted) {
        this.addScore(-25, 'Fehlerhaftes Readback bestätigt (Daten weichen ab)', 'DEL', ac);
        ac.rbWrongAccepted = false;
      }
    }

    onDepartureGone(ac) {
      this.stats.dep++;
      const delay = this.t - (ac.eobt + 12 * 60);
      this.addScore(delay < 5 * 60 ? 15 : 10, delay < 5 * 60 ? 'Abflug pünktlich' : 'Abflug', 'GND', ac);
      this.removeAc(ac);
    }

    onTouchdown(ac) {
      const g = this.approachGeom(ac);
      ac.state = 'LANDING'; ac.mode = 'land'; ac.onGround = true; ac.altFt = 0; ac.visible = true;
      ac.v = U.ktToMs(ac.T.vapp - 10);
      ac.x = g.aimX; ac.y = g.y; ac.hdg = g.hdg;
      this.rwy[ac.rwy].occ = ac.cs;
      // Ausfahrt wählen: erste Ausfahrt hinter der nötigen Ausrollstrecke
      const exits = AP.exits[ac.rwy].slice().sort((a, b) => g.sign > 0 ? b.x - a.x : a.x - b.x);
      const target = g.aimX - g.sign * ac.T.roll * U.range(this.r, 0.85, 1.1);
      let ex = exits.find(e => (g.sign > 0 ? e.x <= target : e.x >= target));
      if (!ex) ex = exits[exits.length - 1];
      ac.exit = ex; ac.exitName = ex.name;
      // seltener Notfall nach der Landung
      if (this.r() < this.opts.errors * 0.15) ac.flags.hotBrakes = true;
    }

    onReachExit(ac) {
      const ex = ac.exit;
      ac.state = 'VACATING';
      const hp = AP.nodes[ex.hp], near = AP.nodes[ex.near];
      ac.path = AP.buildPath([{ x: ac.x, y: ac.y }, { x: hp.x, y: hp.y, node: ex.hp }, { x: near.x, y: near.y, node: ex.near }], 45);
      ac.routeNodes = [ex.hp, ex.near]; ac.routeFrom = ex.rnode;
      ac.s = 0; ac.mode = 'path'; ac.reverse = false; ac.maxV = 9;
      ac.endS = Math.max(0, ac.path.len - 52 - ac.hl);
      const vacS = ac.path.nodeS[ex.hp] + ac.hl + 3;
      ac.flags.vacS = vacS;
      ac.onPathEnd = (a) => { a.mode = null; a.maxV = null; };
      this.atcSay('TWR', ac, R.atc.vacate(ac));
      this.pilotSay(ac, R.pilot.freqReadback(ac, 'GND'), U.range(this.r, 1.5, 2.5), 'TWR');
    }

    checkVacated(ac) {
      if (ac.state === 'VACATING' && !ac.flags.vacatedRwy && ac.s >= ac.flags.vacS) {
        ac.flags.vacatedRwy = true;
        const rs = this.rwy[ac.rwy];
        if (rs.occ === ac.cs) rs.occ = null;
        ac.freq = null;
        this.offerHandoff(ac, 'TWR', 'GND', (a) => {
          if (a.flags.hotBrakes) {
            a.flags.hotBrakes = false;
            this.startEmergencyStop(a, 'brakes');
            return;
          }
          a.state = a.state === 'VACATING' ? 'ARR_TX_REQ' : a.state;
          this.request(a, 'GND', R.pilot.vacated(this, a), U.range(this.r, 1, 3));
        });
      }
    }

    onRunwayChange() {
      // Anflüge neu sequenzieren (andere Seite)
      for (const k of ['N', 'S']) { this.rwy[k].lastArrEta = this.t + 240; }
      const arr = this.list.filter(a => a.kind === 'arr' && (a.state === 'INB' || a.state === 'FINAL')).sort((a, b) => a.eta - b.eta);
      for (const a of arr) { a.state = 'INB'; a.freq = 'APP'; a.visible = false; a.flags.landClr = false; a.eta = Math.max(a.eta, this.t + 240); this.sequenceArrival(a); }
      this.event('runway', 'Betriebsrichtung gewechselt. Prüfe Holding Points und SIDs!', 'warn');
      this.emit('runway');
    }

    // ---------- Notfälle ----------
    emergencyEngineFire(ac) {
      ac.state = 'EMERG'; ac.emergUntil = this.t + 240; ac.flags.emergKind = 'fire';
      this.pilotSay(ac, R.pilot.engineFire(ac), 0, 'GND');
      this.dispatchFire(ac);
      this.event('emerg', `${ac.cs}: Triebwerksbrand gemeldet – Feuerwehr unterwegs. Flugzeug blockiert die Rollgasse.`, 'warn');
    }
    startEmergencyStop(ac, kind) {
      ac.state = 'EMERG'; ac.emergUntil = this.t + 180; ac.flags.emergKind = kind;
      this.pilotSay(ac, R.pilot.brakes(ac), 1, 'GND');
      this.dispatchFire(ac);
    }
    endEmergency(ac) {
      this.vehicles = this.vehicles.filter(v => v.target !== ac.cs || (v.returning = true, true));
      if (ac.flags.emergKind === 'fire') {
        // wird zum Stand zurückgeschleppt und annulliert
        this.addLog({ from: 'sys', text: `${ac.cs} wird zurückgeschleppt, Flug annulliert.`, level: 'info' });
        this.removeAc(ac);
        return;
      }
      ac.state = 'ARR_TX_REQ';
      this.request(ac, 'GND', R.pilot.readyAgain(ac), 1);
    }
    maybeMedical(ac) {
      if (ac.kind === 'dep' && !ac.flags.medChecked && ac.state === 'TAXI' && ac.freq === 'GND') {
        ac.flags.medChecked = true;
        if (this.r() < this.opts.errors * 0.08) {
          this.later(U.range(this.r, 20, 60), () => {
            if (ac.state !== 'TAXI' || ac.freq !== 'GND') return;
            ac.flags.returnToStand = true; ac.holdPos = true;
            this.request(ac, 'GND', R.pilot.medical(ac));
            this.event('emerg', `${ac.cs}: Medizinischer Notfall – Rückkehr zu einem freien Stand.`, 'warn');
          });
        }
      }
    }
    dispatchFire(ac) {
      const fs = { x: -2290, y: 0 };
      for (let i = 0; i < 2; i++) this.vehicles.push({ kind: 'fire', x: fs.x + i * 12, y: fs.y, target: ac.cs, off: i ? 1 : -1 });
    }
    updateVehicles(dt) {
      for (const v of this.vehicles) {
        const t = this.byId[v.target];
        const goal = v.returning || !t ? { x: -2290, y: 0 } : (() => { const d = U.dirVec(t.hdg + 90 * v.off); return { x: t.x + d.x * (t.hw + 14), y: t.y + d.y * (t.hw + 14) }; })();
        const d = U.dist(v.x, v.y, goal.x, goal.y);
        if (d > 2) { const s = Math.min(d, 18 * dt); v.x += (goal.x - v.x) / d * s; v.y += (goal.y - v.y) / d * s; v.hdg = U.hdgOf(goal.x - v.x, goal.y - v.y); }
        else if (v.returning) v.done = true;
      }
      this.vehicles = this.vehicles.filter(v => !v.done);
    }

    // ---------- Verkehr voraus, Konflikte ----------
    groundTraffic() { return this.list.filter(a => a.onGround && a.visible && a.state !== 'GONE'); }

    trafficAhead(ac) {
      const p = ac.path;
      const lvp = this.weather.lvp;
      let look = ac.lookahead != null ? ac.lookahead : Math.min(260, ac.v * ac.v / 2 + 70 + ac.hl);
      if (lvp) look = Math.min(look, Math.max(60, this.weather.vis * 0.35));
      if (look <= 0) return null;
      const others = this.groundTraffic().filter(o => o !== ac && U.dist(o.x, o.y, ac.x, ac.y) < look + ac.hl + o.hl + 60);
      if (!others.length) return null;
      const oboxes = others.map(o => ({ o, b: o.box }));
      // Flugzeuge, die schon jetzt überlappen (z. B. Nachbarstand), ignorieren
      const me = ac.box;
      const ignore = new Set(oboxes.filter(x => U.shapeOverlap(me, x.b, 3)).map(x => x.o));
      for (let d = 8; d <= look; d += 6) {
        const s2 = ac.s + d;
        if (s2 > p.len + ac.hl) break;
        const at = AP.pathAt(p, Math.min(s2, p.len));
        const hd = ac.reverse ? (at.hdg + 180) % 360 : at.hdg;
        const bx = U.acShape(at.x, at.y, hd, ac.T.len, ac.T.span);
        for (const { o, b } of oboxes) {
          if (ignore.has(o)) continue;
          if (U.shapeOverlap(bx, b, 8)) return { s: ac.s + d - 8, other: o };
        }
      }
      return null;
    }

    checkConflicts(dt) {
      const g = this.groundTraffic();
      for (const ac of g) {
        if (ac.state === 'VACATING') this.checkVacated(ac);
        if (ac.state === 'TAXI') this.maybeMedical(ac);
        // Taxi-Readback-Fehler nicht korrigiert
        if (ac.rbTaxiErr && this.t > ac.rbTaxiErr.deadline) {
          ac.rbTaxiErr = null;
          this.addScore(-15, 'Fehlerhaftes Taxi-Readback nicht korrigiert', 'GND', ac);
        }
        // Unkoordinierter Stopp wegen Verkehr (kreuzend / Gegenverkehr / Pushback)
        if (ac.blockedBy && ac.blockedT > 4 && ac.mode === 'path' && !ac.flags.pushing) {
          const o = this.byId[ac.blockedBy];
          if (!o) continue;
          const same = Math.abs(U.angDiff(ac.hdg, o.hdg)) < 50 && !o.flags.pushing;
          const queued = ['AT_HP', 'TWR_HOLD', 'LINEUP'].includes(o.state) || (o.mode === 'path' && o.v < 0.3 && same);
          const instructed = (ac.giveWay && ac.giveWay.target === o.cs) || ac.follow === o.cs;
          const key = [ac.cs, o.cs].sort().join('|');
          if (!same && !queued && !instructed && (!this.pairPenalty[key] || this.t - this.pairPenalty[key] > 180)) {
            this.pairPenalty[key] = this.t;
            this.stats.conflicts++;
            const resp = ac.freq === 'TWR' || o.freq === 'TWR' ? (ac.freq === 'GND' || o.freq === 'GND' ? 'GND' : 'TWR') : 'GND';
            this.addScore(-10, 'Bodenkonflikt – Flugzeug musste für Verkehr anhalten', resp, ac);
            if (ac.freq === 'GND') this.pilotSay(ac, R.pilot.stoppingTraffic(ac), 0.5, 'GND');
          }
          // Gegenseitige Blockade
          if (o.blockedBy === ac.cs && o.blockedT > 4 && ac.blockedT > 8 && !ac.flags.deadlock) {
            ac.flags.deadlock = o.flags.deadlock = true;
            this.addScore(-30, 'Blockade: zwei Flugzeuge stehen sich gegenüber', 'GND', ac);
            if (ac.freq === 'GND') { ac.flags.blockedCall = true; this.request(ac, 'GND', R.pilot.blocked(ac, o), 1); }
          }
        } else if (ac.blockedT === 0) ac.flags.deadlock = false;
      }
      // Kollision
      for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
        const a = g[i], b = g[j];
        if (U.dist(a.x, a.y, b.x, b.y) > a.hl + b.hl + a.hw + b.hw) continue;
        if (!a.moving && !b.moving) continue;
        if (U.shapeOverlap(a.box, b.box, -1.5)) {
          const sh = (o) => o.state === 'PARKED' || o.state === 'PRE' || o.state === 'CLR_REQ' || o.state === 'CLR_RB' || o.state === 'CLEARED' || o.state === 'GND_WAIT' || o.state === 'PB_REQ';
          if (sh(a) && sh(b)) continue;
          this.addLog({ from: 'sys', text: `KOLLISION zwischen ${a.cs} und ${b.cs}!`, level: 'bad', dbg: [a.state, a.v.toFixed(1), b.state, b.v.toFixed(1)].join(' ') });
          this.collision = { a: a.cs, b: b.cs, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          this.endShift('Kollision');
          return;
        }
      }
    }

    // ---------- KI-Delivery ----------
    aiDelivery() {
      const op = this.weather.opDir;
      for (const ac of this.list) {
        if (ac.kind === 'dep' && ac.plan && !ac.rbPending && ['CLEARED', 'GND_WAIT', 'PB_REQ', 'PB_HOLD', 'PUSHING', 'STARTUP', 'TAXI_REQ'].includes(ac.state)
          && !D.sidMatches(ac.plan.sid, op) && (ac.flags.revT || 0) < this.t) {
          ac.flags.revT = this.t + 30;
          this.cmdClearance(ac, {});
          this.later(4, () => { if (ac.rbPending) this.confirmReadback(ac); });
          break;
        }
      }
      for (const ac of this.list) {
        if (ac.freq !== 'DEL') continue;
        if (ac.state === 'CLR_REQ' && ac.waitSince != null && this.t - ac.waitSince > (ac.aiDelay || (ac.aiDelay = U.range(this.r, 4, 10)))) {
          ac.aiDelay = null; this.cmdClearance(ac, {});
        } else if (ac.state === 'CLR_RB' && !ac.flags.aiRbT) {
          ac.flags.aiRbT = this.t + 5;
        } else if (ac.state === 'CLR_RB' && ac.flags.aiRbT && this.t > ac.flags.aiRbT) {
          ac.flags.aiRbT = null;
          const p = ac.pilotPlan, c = ac.plan;
          if (p.sq !== c.sq || p.alt !== c.alt || p.sid !== c.sid) this.cmdClearance(ac, c);
          else { this.cmdReadbackCorrect(ac); this.later(3, () => { if (ac.freq === 'DEL') this.cmdContactGround(ac); }); }
        }
      }
    }

    // ---------- KI-Ground ----------
    aiGround() {
      const op = this.weather.opDir;
      for (const ac of this.list) {
        if (ac.freq !== 'GND') continue;
        if (ac.waitSince == null || this.t - ac.waitSince < 4) continue;
        if (ac.state === 'PB_REQ') {
          const opts = this.pushOptions(ac);
          if (this.pushBusy(ac, opts)) continue;
          // Richtung und Holding Point mit der günstigsten Route (Standard-Rollrichtungen)
          let best = opts[0], bestC = Infinity;
          for (const o of opts) for (const hp of this.depHpCandidates(ac, op)) {
            const r = AP.findRoute({ from: o.back, to: o.lane }, AP.hps[hp].node, null, { flow: op });
            if (r && r.cost < bestC) { bestC = r.cost; best = o; }
          }
          this.cmdPushback(ac, best.word[0].toUpperCase());
        } else if (ac.state === 'TAXI_REQ') {
          const s0 = ac.routeStart();
          let best = null, bestC = Infinity;
          for (const hp of this.depHpCandidates(ac, op)) {
            const r = AP.findRoute(s0, AP.hps[hp].node, null, { flow: op });
            if (r && r.cost < bestC) { bestC = r.cost; best = hp; }
          }
          if (!best) best = this.aiFallbackHp(ac, op);
          if (best && this.aiRouteClear(ac, s0, AP.hps[best].node)) this.cmdTaxi(ac, best, null, true);
          else if (best && this.t - ac.waitSince > 120 && this.aiRouteClear(ac, s0, AP.hps[best].node, true)) this.cmdTaxi(ac, best, null, true, true); // notfalls Schlepper
        } else if (ac.state === 'AT_HP') {
          if (ac.flags.waitingRevised) {
            ac.flags.waitingRevised = false; this.cmdClearance(ac, {}); this.answered(ac);
            this.later(5, () => { if (ac.rbPending) this.confirmReadback(ac); if (ac.state === 'AT_HP' && ac.freq === 'GND') this.cmdContactTower(ac); });
          }
          else if (!this.hpValidNow(ac.taxiDest.name)) this.cmdTaxi(ac, this.aiPickHp(ac, op) || this.aiFallbackHp(ac, op), null, true);
          else this.cmdContactTower(ac);
        } else if (ac.state === 'ARR_TX_REQ') {
          if (!ac.stand) { const s = this.pickStand(ac); if (s) { ac.stand = s; this.standRes[s] = ac.cs; } else continue; }
          if (this.aiRouteClear(ac, ac.routeStart(), AP.stands[ac.stand].node)) this.cmdTaxi(ac, ac.stand, null, true);
        } else if (ac.state === 'TAXI' && ac.flags.needReroute && ac.taxiDest) {
          if (this.aiRouteClear(ac, ac.routeStart(), ac.taxiDest.node)) this.cmdTaxi(ac, ac.taxiDest.name, null, true);
        } else if (ac.state === 'TAXI' && ac.flags.returnToStand) {
          const s = this.pickStand(ac); if (s) this.cmdTaxi(ac, s, null, true);
        } else if (ac.state === 'TAXI' && ac.flags.blockedCall) {
          this.cmdContinue(ac);
        }
      }
      // nach Betriebsrichtungswechsel: Abflüge zu neuen Holding Points umleiten
      for (const ac of this.list) {
        if (ac.freq === 'GND' && ac.state === 'TAXI' && ac.kind === 'dep' && ac.taxiDest && ac.taxiDest.type === 'hp' && !this.hpValidNow(ac.taxiDest.name) && !ac.flags.returnToStand) {
          const hp = this.aiPickHp(ac, op) || this.aiFallbackHp(ac, op);
          if (hp && (ac.flags.rerouteTry || 0) < this.t) {
            ac.flags.rerouteTry = this.t + 10;
            if (this.aiRouteClear(ac, ac.routeStart(), AP.hps[hp].node)) { ac.holdPos = false; this.cmdTaxi(ac, hp, null, true); }
            else ac.holdPos = true; // erst einmal stehen bleiben, bis frei
          }
        }
      }
      // rechtzeitig an Tower übergeben
      for (const ac of this.list) {
        if (ac.freq === 'GND' && ac.state === 'TAXI' && ac.kind === 'dep' && ac.taxiDest && ac.taxiDest.type === 'hp' && ac.path && ac.path.len - ac.s < 350
          && !ac.flags.needReroute && !ac.flags.missedTurn && ac.waitSince == null && this.hpValidNow(ac.taxiDest.name)) this.cmdContactTower(ac);
      }
    }
    // Ist Verkehr in der Nähe, der durch einen Pushback behindert würde?
    pushBusy(ac, opts) {
      const L = AP.nodes[opts[0].lane];
      const near = new Set([opts[0].lane, ...opts.map(o => o.back)]);
      return this.groundTraffic().some(o => {
        if (o === ac) return false;
        const d = U.dist(o.x, o.y, L.x, L.y);
        if (['STARTUP', 'PUSHING', 'TOW_WAIT', 'EMERG', 'TAXI_REQ'].includes(o.state) || (o.state === 'TAXI' && o.mode !== 'path')) return d < 220;
        if (o.mode !== 'path') return false;
        if (d < 180) return true;
        return o.remainingNodes().some(n => near.has(n));
      });
    }

    // KI-Ground: keine Rollfreigabe hinter einem laufenden Pushback vorbei und kein Gegenverkehr auf derselben Kante
    aiRouteClear(ac, start, destNode, allowReverse) {
      const r = start && AP.findRoute(start, destNode, null, { flow: this.weather.opDir, allowReverse: !!allowReverse });
      if (!r) return true;
      const set = new Set(r.nodes);
      if (this.list.some(o => o !== ac && o.state === 'PUSHING' && o.push && (set.has(o.push.lane) || set.has(o.push.back)))) return false;
      const mine = new Set();
      for (let i = 0; i < r.nodes.length - 1; i++) mine.add(r.nodes[i] + '>' + r.nodes[i + 1]);
      // stehende Flugzeuge auf Rollwegen, die uns entgegenschauen (z. B. nach Pushback)
      const parkedLike = ['PRE', 'CLR_REQ', 'CLR_RB', 'CLEARED', 'GND_WAIT', 'PB_REQ', 'PB_HOLD', 'PARKED', 'TWR_HOLD', 'AT_HP', 'LINEUP', 'TAKEOFF'];
      for (const o of this.groundTraffic()) {
        if (o === ac || o.mode === 'path' || parkedLike.includes(o.state)) continue;
        for (let i = 0; i < r.nodes.length - 1; i++) {
          const a = AP.nodes[r.nodes[i]], b = AP.nodes[r.nodes[i + 1]];
          const L = U.dist(a.x, a.y, b.x, b.y) || 1;
          const t = U.clamp(((o.x - a.x) * (b.x - a.x) + (o.y - a.y) * (b.y - a.y)) / (L * L), 0, 1);
          const d = U.dist(o.x, o.y, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
          if (d < o.hw + 15 && Math.abs(U.angDiff(U.hdgOf(b.x - a.x, b.y - a.y), o.hdg)) > 100) return false;
        }
      }
      for (const o of this.list) {
        if (o === ac || o.mode !== 'path' || !o.routeNodes) continue;
        const rem = [o.routeStart() && o.routeStart().from, ...o.remainingNodes()].filter(Boolean);
        for (let i = 0; i < rem.length - 1; i++) if (mine.has(rem[i + 1] + '>' + rem[i])) return false;
      }
      return true;
    }

    aiFallbackHp(ac, op) {
      const c = this.depHpCandidates(ac, op).sort((a, b) => AP.hps[b].tora[op] - AP.hps[a].tora[op]);
      const st = AP.stands[ac.stand];
      return c.find(n => !st || AP.hps[n].rwy === (st.side === 'S' ? 'S' : 'N')) || c[0];
    }

    depHpCandidates(ac, op) {
      return AP.depHps(op).filter(n => AP.hps[n].tora[op] >= ac.T.tora);
    }
    aiPickHp(ac, op) {
      const s0 = ac.routeStart();
      let best = null, bestC = Infinity;
      for (const hp of this.depHpCandidates(ac, op)) {
        const r = s0 && AP.findRoute(s0, AP.hps[hp].node, null, { flow: op });
        if (r && r.cost < bestC) { bestC = r.cost; best = hp; }
      }
      return best;
    }

    // ---------- Infos für die Oberfläche ----------
    needsAction(ac) {
      if (ac.handoff && !ac.handoff.autoAt && this.isPlayer(ac.handoff.to)) return ac.handoff.to;
      if (ac.waitSince != null && ac.waitRole && this.isPlayer(ac.waitRole) && this.t >= ac.waitSince) return ac.waitRole;
      if (ac.rbPending && ac.freq === 'DEL' && this.isPlayer('DEL')) return 'DEL';
      return null;
    }
  }

  Sim.POS_ORDER = POS_ORDER;
  ATC.Sim = Sim;
})(ATC);
