// Bedienoberfläche: Flugliste, Detailpanel mit Befehlen, Funk-Log, Befehlszeile, Hilfe, Schichtende.
(function (ATC) {
  const U = ATC.U, AP = ATC.AP, D = ATC.D, CMD = ATC.CMD, R = ATC.R;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const FACING_DE = { north: 'Norden', east: 'Osten', south: 'Süden', west: 'Westen' };

  class UI {
    constructor(app) {
      this.app = app;
      this.selected = null;
      this.drafts = {};          // Formularentwürfe je Flugzeug
      this.detailKey = '';
      this.lastList = 0;
      this.radioCount = 0;
      this.bindStatic();
    }

    get sim() { return this.app.sim; }

    bindStatic() {
      $('cmdForm').addEventListener('submit', (e) => { e.preventDefault(); this.submitCmd(); });
      $('cmd').addEventListener('input', () => this.updateHint());
      $('cmd').addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { $('cmd').value = ''; $('cmd').blur(); this.updateHint(); }
        if (e.key === 'ArrowUp' && this.history && this.history.length) { e.preventDefault(); this.hIdx = Math.max(0, (this.hIdx ?? this.history.length) - 1); $('cmd').value = this.history[this.hIdx]; }
        if (e.key === 'ArrowDown' && this.history && this.hIdx != null) { e.preventDefault(); this.hIdx = Math.min(this.history.length, this.hIdx + 1); $('cmd').value = this.history[this.hIdx] || ''; }
      });
      $('flightList').addEventListener('click', (e) => {
        const acc = e.target.closest('[data-acc]');
        if (acc) { e.stopPropagation(); this.run(acc.dataset.acc + ' ACC'); return; }
        const row = e.target.closest('[data-cs]');
        if (row) this.select(row.dataset.cs, false);
      });
      $('flightList').addEventListener('dblclick', (e) => { const row = e.target.closest('[data-cs]'); if (row) this.select(row.dataset.cs, true); });
      $('detail').addEventListener('click', (e) => this.onDetailClick(e));
      $('detail').addEventListener('change', (e) => this.onDetailChange(e));
      $('detail').addEventListener('input', (e) => this.onDetailChange(e));
      $('btnHelp').addEventListener('click', () => this.showHelp());
      $('helpClose').addEventListener('click', () => { $('help').hidden = true; });
      $('btnFlows').addEventListener('click', () => {
        this.app.renderer.showFlows = !this.app.renderer.showFlows;
        $('btnFlows').classList.toggle('on', this.app.renderer.showFlows);
      });
      $('btnTts').addEventListener('click', () => this.setTts(!R.tts.enabled));
      document.querySelectorAll('#speed button').forEach(b => b.addEventListener('click', () => this.app.setSpeed(+b.dataset.speed)));
      document.querySelectorAll('.mapbtns button').forEach(b => b.addEventListener('click', () => this.app.view(b.dataset.view)));
    }

    setTts(on) {
      R.tts.enabled = on;
      if (!on) R.tts.stop();
      $('btnTts').textContent = on ? 'Sprache an' : 'Sprache aus';
      $('btnTts').classList.toggle('on', on);
    }

    reset() {
      this.selected = null; this.drafts = {}; this.detailKey = ''; this.radioCount = 0;
      $('radio').innerHTML = ''; $('detail').innerHTML = '<p class="empty">Wähle ein Flugzeug in der Liste oder auf der Karte.</p>';
      this.app.renderer.preview = null;
      const roles = ['DEL', 'GND'].filter(p => this.sim.isPlayer(p)).map(p => D.ROLE_NAME[p]);
      $('roleInfo').textContent = roles.length ? 'Du: ' + roles.join(' + ') : 'Nur Zuschauen';
    }

    toast(msg, kind) {
      const t = $('toast');
      t.textContent = msg; t.className = 'toast' + (kind ? ' ' + kind : ''); t.hidden = false;
      clearTimeout(this.toastT); this.toastT = setTimeout(() => { t.hidden = true; }, 4200);
    }

    select(cs, center) {
      this.selected = cs;
      this.detailKey = '';
      this.app.renderer.preview = null;
      if (center) { const ac = this.sim.byId[cs]; if (ac && ac.visible) { this.app.renderer.cam.x = ac.x; this.app.renderer.cam.y = ac.y; if (this.app.renderer.cam.scale < 0.6) this.app.renderer.cam.scale = 0.8; } }
      this.renderDetail(true); this.renderList(true); this.updateHint();
    }

    // ---------- Befehle ----------
    run(text) {
      const sel = this.selected ? this.sim.byId[this.selected] : null;
      const r = CMD.run(this.sim, text, sel);
      if (!r.ok) this.toast(r.msg || 'Befehl nicht möglich.');
      else if (r.ac && r.ac.cs !== this.selected) this.select(r.ac.cs);
      this.detailKey = '';
      this.renderDetail(true); this.renderList(true);
      return r;
    }
    submitCmd() {
      const v = $('cmd').value.trim();
      if (!v) return;
      const r = this.run(v);
      if (r.ok) this.app.typedCount = (this.app.typedCount || 0) + 1;
      this.history = this.history || []; this.history.push(v); this.hIdx = null;
      if (r.ok) $('cmd').value = '';
      this.updateHint();
    }
    updateHint() {
      const v = $('cmd').value.trim().toUpperCase();
      const sel = this.selected ? this.sim.byId[this.selected] : null;
      $('cmdTarget').textContent = sel ? sel.cs : '—';
      let hint = '';
      const toks = v.split(/\s+/).filter(Boolean);
      const key = toks.find(t => CMD.DEFS[t]);
      if (key) hint = `${key}: ${CMD.DEFS[key].help}  –  Beispiel: ${CMD.DEFS[key].ex}`;
      else if (sel) hint = this.suggestFor(sel);
      $('cmdHint').textContent = hint;
    }
    suggestFor(ac) {
      const sim = this.sim;
      const s = ac.state;
      if (ac.handoff && sim.isPlayer(ac.handoff.to)) return 'Vorschlag: ACC (Übergabe annehmen)';
      if (ac.freq === 'DEL') {
        if (s === 'CLR_REQ') return 'Vorschlag: CLR  (Standardfreigabe)';
        if (ac.rbPending) return 'Readback prüfen: RBC wenn korrekt, sonst CLR erneut';
        return 'Vorschlag: GND (an Ground übergeben)';
      }
      if (ac.freq === 'GND') {
        if (s === 'PB_REQ') return 'Vorschlag: PB ' + (sim.pushOptions(ac).map(o => o.word[0].toUpperCase()).join(' oder PB '));
        if (s === 'TAXI_REQ' || s === 'ARR_TX_REQ') return 'Vorschlag: TX <Ziel> VIA <Rollwege>  – die Routenhilfe rechts füllt das aus';
        if (s === 'TAXI' || s === 'AT_HP') return ac.kind === 'dep' ? 'HOLD · CONT · HS <Rollweg> · GW <Rufzeichen> · TWR' : 'HOLD · CONT · HS <Rollweg> · GW <Rufzeichen>';
      }
      return '';
    }

    // ---------- Kopfzeile ----------
    renderTop() {
      const sim = this.sim, w = sim.weather;
      $('clock').textContent = U.hhmmss(sim.clock);
      $('shiftLeft').textContent = sim.opts.tutorial ? 'Tutorial' : 'noch ' + U.mmss(sim.opts.duration - sim.t);
      $('score').textContent = sim.score;
      const op = w.opDir === 27 ? '27' : '09';
      let h = `<span class="letter" title="ATIS-Kennung">${w.letter}</span>`;
      h += `<span>Bahnen <span class="rwy">${AP.rwyName('N', w.opDir)} / ${AP.rwyName('S', w.opDir)}</span></span>`;
      h += `<span>Wind ${w.windText()}</span><span class="opt">Sicht ${w.visText()}</span><span class="opt">QNH ${w.qnh}</span>`;
      if (w.lvp) h += `<span class="lvp">LVP</span>`;
      if (w.pendingChange) h += `<span class="change">Wechsel auf ${w.pendingChange.to === 27 ? '27' : '09'} um ${U.hhmm(sim.clock0 + w.pendingChange.at)}</span>`;
      else if (w.prevOpDir && sim.t < w.changedAt + 600) h += `<span class="change">Übergang: Starts in Richtung ${w.prevOpDir === 27 ? '27' : '09'} noch bis ${U.hhmm(sim.clock0 + w.changedAt + 600)}</span>`;
      void op;
      if (h !== this.atisHtml) { $('atis').innerHTML = h; this.atisHtml = h; }
      document.querySelectorAll('#speed button').forEach(b => b.classList.toggle('on', +b.dataset.speed === this.app.speed));
    }

    // ---------- Flugliste ----------
    groupOf(ac) {
      if (ac.state === 'PRE' || ac.freq === 'DEL' || (ac.handoff && ac.handoff.to === 'DEL')) return 'DEL';
      if (ac.freq === 'GND' || (ac.handoff && ac.handoff.to === 'GND')) return 'GND';
      if (ac.state === 'INB') return 'APP';
      return 'TWR';
    }
    renderList(force) {
      const now = performance.now();
      if (!force && now - this.lastList < 400) return;
      this.lastList = now;
      const sim = this.sim;
      const groups = { DEL: [], GND: [], TWR: [], APP: [] };
      for (const ac of sim.list) { if (ac.state === 'SCHED' || ac.state === 'GONE') continue; groups[this.groupOf(ac)].push(ac); }
      const names = { DEL: 'Delivery', GND: 'Ground', TWR: 'Tower', APP: 'Anflug' };
      let html = '';
      for (const g of ['DEL', 'GND', 'TWR', 'APP']) {
        const list = groups[g];
        const mine = sim.isPlayer(g);
        list.sort((a, b) => {
          const na = sim.needsAction(a) ? 0 : 1, nb = sim.needsAction(b) ? 0 : 1;
          if (na !== nb) return na - nb;
          return (a.kind === 'arr' ? a.eta : a.eobt) - (b.kind === 'arr' ? b.eta : b.eobt);
        });
        html += `<div class="fl-group"><h3><span>${names[g]}${mine ? '' : ' (KI)'}</span><span>${list.length}</span></h3>`;
        for (const ac of list) html += this.rowHtml(ac, mine);
        html += '</div>';
      }
      if (html !== this.listHtml) { $('flightList').innerHTML = html; this.listHtml = html; }
    }
    rowHtml(ac, mine) {
      const sim = this.sim;
      const need = sim.needsAction(ac);
      const ho = ac.handoff && sim.isPlayer(ac.handoff.to) && !ac.handoff.autoAt;
      let cls = 'fl-row';
      if (ac.cs === this.selected) cls += ' sel';
      if (ho) cls += ' handoff'; else if (need) cls += ' need';
      if (!mine && !need && !ho) cls += ' other';
      const sub = ac.kind === 'arr'
        ? `${ac.type} · aus ${esc(ac.orig.city)} · ${ac.stand ? 'Stand ' + ac.stand : 'kein Stand'}${ac.state === 'INB' || ac.state === 'FINAL' ? ' · ETA ' + U.hhmm(sim.clock0 + ac.eta) : ''}`
        : `${ac.type} · ${ac.stand ? ac.stand : ''} → ${esc(ac.dest.city)} · EOBT ${U.hhmm(sim.clock0 + ac.eobt)}`;
      let state = ho ? 'Übergabe' : (ATC.STATE_LABEL[ac.state] || ac.state);
      if (ac.state === 'TAXI' && ac.taxiDest) state = 'Rollt → ' + ac.taxiDest.name;
      if (ac.holdPos) state += ' (hält)';
      let wait = '';
      if (ac.waitSince != null && sim.t >= ac.waitSince) {
        const w = sim.t - ac.waitSince;
        wait = `<span class="fl-wait ${w > 60 ? 'late' : ''}">${U.mmss(w)}</span>`;
      }
      const accBtn = ho ? `<button class="acc" data-acc="${ac.cs}">Annehmen</button>` : '';
      return `<div class="${cls}" data-cs="${ac.cs}"><span class="fl-cs">${ac.cs}</span><span class="fl-state">${esc(state)}</span><span class="fl-sub">${sub}</span>${accBtn || wait}</div>`;
    }

    // ---------- Detailpanel ----------
    detailKeyOf(ac) {
      const sim = this.sim;
      return [ac.cs, ac.state, ac.freq, ac.handoff && ac.handoff.to, ac.handoff && !!ac.handoff.autoAt, ac.rbPending, ac.stand, ac.taxiDest && ac.taxiDest.name,
        ac.plan && ac.plan.sid, ac.plan && ac.plan.sq, ac.holdPos, !!ac.holdShort, !!ac.giveWay, sim.weather.opDir, !!sim.needsAction(ac), ac.flags.returnToStand, ac.mode,
        Math.floor(sim.t / 5)].join('|');
    }

    renderDetail(force) {
      const sim = this.sim;
      const ac = this.selected ? sim.byId[this.selected] : null;
      const el = $('detail');
      if (!ac) {
        if (this.detailKey !== 'none') { el.innerHTML = '<p class="empty">Wähle ein Flugzeug in der Liste oder auf der Karte.</p>'; this.detailKey = 'none'; this.app.renderer.preview = null; }
        return;
      }
      const key = this.detailKeyOf(ac);
      // Bei laufender Eingabe nicht neu aufbauen
      const active = document.activeElement;
      if (!force && key === this.detailKey) { this.liveDetail(ac); return; }
      if (!force && active && el.contains(active) && (active.tagName === 'INPUT' || active.tagName === 'SELECT') && key.split('|').slice(0, -1).join('|') === this.detailKey.split('|').slice(0, -1).join('|')) { this.liveDetail(ac); return; }
      this.detailKey = key;
      el.innerHTML = this.detailHtml(ac);
      this.liveDetail(ac);
      this.updatePreview();
      this.updateHint();
    }

    liveDetail(ac) {
      const sim = this.sim;
      const w = document.getElementById('d-wait');
      if (w) w.textContent = ac.waitSince != null && sim.t >= ac.waitSince ? 'wartet seit ' + U.mmss(sim.t - ac.waitSince) : '';
      const eta = document.getElementById('d-eta');
      if (eta && ac.eta != null) eta.textContent = U.hhmm(sim.clock0 + ac.eta) + ' (in ' + U.mmss(ac.eta - sim.t) + ')';
    }

    detailHtml(ac) {
      const sim = this.sim, op = sim.weather.opDir;
      const need = sim.needsAction(ac);
      const al = ac.airline;
      let h = `<div class="d-head"><span class="d-swatch" style="background:${al.liv.tail}"></span><div><div class="d-cs">${ac.cs}</div><div class="d-tel">${esc(al.name)} · Rufzeichen „${esc(ac.telephony)}“</div></div></div>`;
      let st = ATC.STATE_LABEL[ac.state] || ac.state;
      if (ac.handoff) st = `Übergabe ${D.ROLE_NAME[ac.handoff.from] || ''} → ${D.ROLE_NAME[ac.handoff.to]}`;
      h += `<div class="d-state ${need ? 'need' : ''}">${esc(st)} ${ac.freq ? '· ' + D.ROLE_NAME[ac.freq] + ' ' + D.FREQ[ac.freq] : ''} <span id="d-wait" class="muted"></span></div>`;
      h += '<dl class="d-grid">';
      h += `<dt>Typ</dt><dd>${ac.type} · ${esc(ac.T.name)} · Wirbel ${ac.T.wake}</dd>`;
      if (ac.kind === 'dep' || ac.kind === 'done') {
        h += `<dt>Ziel</dt><dd>${esc(ac.dest.city)} (${ac.dest.icao})</dd><dt>Stand</dt><dd>${ac.stand || '–'}</dd><dt>EOBT</dt><dd>${U.hhmm(sim.clock0 + ac.eobt)}</dd>`;
        if (ac.plan) {
          const bad = !D.sidMatches(ac.plan.sid, op);
          h += `<dt>SID</dt><dd class="${bad ? 'warn' : ''}">${ac.plan.sid}${bad ? ' – passt nicht zur Betriebsrichtung' : ''}</dd><dt>Initial</dt><dd>${ac.plan.alt} ft</dd><dt>Squawk</dt><dd>${ac.plan.sq}${ac.pilotPlan && ac.pilotPlan.sq !== ac.plan.sq && !ac.rbPending ? '' : ''}</dd>`;
        }
        h += `<dt>Benötigt</dt><dd>${ac.T.tora} m Startbahn</dd>`;
      } else {
        h += `<dt>Herkunft</dt><dd>${esc(ac.orig.city)} (${ac.orig.icao})</dd><dt>Stand</dt><dd>${ac.stand || '<span class="warn">nicht zugewiesen</span>'}</dd>`;
        if (ac.rwy) h += `<dt>Landebahn</dt><dd>${AP.rwyName(ac.rwy, op)}</dd>`;
        if (ac.state === 'INB' || ac.state === 'FINAL') h += `<dt>ETA</dt><dd id="d-eta"></dd>`;
      }
      if (ac.taxiDest) h += `<dt>Rollziel</dt><dd>${ac.taxiDest.type === 'hp' ? 'Holding Point ' : 'Stand '}${ac.taxiDest.name}</dd>`;
      h += '</dl>';

      // letzter Pilotenspruch zu diesem Flugzeug (zum Prüfen des Readbacks)
      const last = [...sim.log].reverse().find(l => l.ac === ac.cs && l.from === 'pilot');
      if (last) h += `<div class="d-rb">„${esc(last.text)}“</div>`;

      if (ac.handoff && sim.isPlayer(ac.handoff.to) && !ac.handoff.autoAt) {
        h += `<div class="d-section"><button class="acc" data-cmd="ACC">Übergabe annehmen</button></div>`;
      }
      if (sim.isPlayer('DEL')) h += this.delHtml(ac);
      if (sim.isPlayer('GND')) h += this.gndHtml(ac);
      return h;
    }

    draft(ac) { return this.drafts[ac.cs] || (this.drafts[ac.cs] = {}); }

    delHtml(ac) {
      const sim = this.sim, op = sim.weather.opDir;
      if (ac.kind !== 'dep') return '';
      const onDel = ac.freq === 'DEL';
      const revisable = ac.plan && !D.sidMatches(ac.plan.sid, op) && ['GND_WAIT', 'PB_REQ', 'PB_HOLD', 'PUSHING', 'STARTUP', 'TAXI_REQ', 'TAXI', 'AT_HP', 'CLEARED'].includes(ac.state);
      if (!onDel && !revisable) return '';
      const d = this.draft(ac);
      const def = { sid: D.sidFor(ac.dest.dir, op), alt: D.SID_ALT[ac.dest.dir] };
      if (!d.sq) d.sq = ac.plan ? ac.plan.sq : sim.newSquawk();
      const sid = d.sid && D.sidMatches(d.sid, op) ? d.sid : (ac.plan && D.sidMatches(ac.plan.sid, op) ? ac.plan.sid : def.sid);
      const alt = d.alt || (ac.plan ? ac.plan.alt : def.alt);
      const sids = [];
      for (const dir of ['W', 'N', 'E', 'S']) for (const o of [27, 9]) sids.push(D.sidFor(dir, o));
      let h = `<div class="d-section"><h4>Delivery – Streckenfreigabe</h4>`;
      if (revisable) h += `<p class="d-note">Die SID passt nach dem Betriebsrichtungswechsel nicht mehr. Gib eine neue Freigabe.</p>`;
      h += `<div class="d-row">
        <label class="grow">SID<select data-f="sid">${sids.map(s => `<option ${s === sid ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        <label>Höhe<select data-f="alt">${[4000, 5000, 6000, 7000, 8000].map(a => `<option value="${a}" ${a === alt ? 'selected' : ''}>${a} ft</option>`).join('')}</select></label>
        <label>Squawk<input data-f="sq" value="${d.sq}" size="5" maxlength="4"></label></div>`;
      h += `<p class="d-note">Standard für ${esc(ac.dest.city)}: ${def.sid}, ${def.alt} ft (Richtung ${({ W: 'West', N: 'Nord', E: 'Ost', S: 'Süd' })[ac.dest.dir]}).</p>`;
      h += `<div class="d-row"><button class="primary" data-act="clr">${ac.plan ? 'Freigabe erneut erteilen' : 'Freigabe erteilen'}</button>`;
      if (onDel) h += `<button data-cmd="RBC" ${ac.rbPending ? '' : 'disabled'}>Readback korrekt</button><button data-cmd="GND" ${ac.plan ? '' : 'disabled'}>An Ground ${D.FREQ.GND}</button>`;
      h += `</div></div>`;
      return h;
    }

    gndHtml(ac) {
      const sim = this.sim, op = sim.weather.opDir;
      let h = '';
      const onGnd = ac.freq === 'GND';
      // Stand für Ankünfte (auch vorab)
      if (ac.kind === 'arr' && ac.state !== 'PARKED') {
        const free = AP.standIds.filter(id => sim.standFits(ac, id) && sim.standFree(id, ac.cs));
        h += `<div class="d-section"><h4>Stand</h4><div class="d-row"><select data-f="stand" class="grow">${free.map(id => `<option ${id === ac.stand ? 'selected' : ''}>${id}</option>`).join('')}</select><button data-act="stand">Zuweisen</button></div></div>`;
      }
      if (!onGnd) return h;
      const s = ac.state;
      if (s === 'PB_REQ' || s === 'PB_HOLD') {
        const opts = sim.pushOptions(ac);
        h += `<div class="d-section"><h4>Ground – Pushback</h4><div class="d-row">${opts.map(o => `<button class="primary" data-cmd="PB ${o.word[0].toUpperCase()}">Pushback, Blick ${FACING_DE[o.word]}</button>`).join('')}</div>`;
        if (s === 'PB_REQ') h += `<div class="d-row"><select data-f="pbmins">${[1, 2, 3, 5, 8].map(m => `<option value="${m}">${m} min</option>`).join('')}</select><button data-act="pbh">Pushback verzögern</button></div>`;
        h += `<p class="d-note">Achte auf Verkehr in der Rollgasse hinter dem Flugzeug. Pfeile zeigen die Standard-Rollrichtung (Knopf „Rollrichtungen“).</p></div>`;
      }
      const canTaxi = (ac.kind === 'dep' && ['TAXI_REQ', 'TAXI', 'AT_HP'].includes(s)) || (ac.kind === 'arr' && ['ARR_TX_REQ', 'TAXI', 'VACATING'].includes(s)) || ac.flags.returnToStand;
      if (canTaxi) {
        const d = this.draft(ac);
        let dests;
        if (ac.kind === 'dep' && !ac.flags.returnToStand) {
          dests = AP.hpNames.filter(n => AP.hps[n].depFor != null).map(n => {
            const hp = AP.hps[n];
            const valid = sim.hpValidNow(n);
            const short = hp.tora[hp.depFor] < ac.T.tora;
            return { v: n, t: `${n} – Bahn ${AP.rwyName(hp.rwy, hp.depFor)}, ${hp.tora[hp.depFor]} m${short ? ' (zu kurz)' : ''}${valid ? '' : ' (falsche Richtung)'}`, ok: valid && !short };
          }).sort((a, b) => (b.ok - a.ok));
        } else {
          dests = AP.standIds.filter(id => sim.standFits(ac, id) && sim.standFree(id, ac.cs)).map(id => ({ v: id, t: `Stand ${id} (${AP.stands[id].area})`, ok: true }));
          if (ac.stand) dests.sort((a, b) => (b.v === ac.stand) - (a.v === ac.stand));
        }
        if (!d.dest || !dests.find(x => x.v === d.dest)) {
          const best = ac.kind === 'dep' && !ac.flags.returnToStand ? sim.aiPickHp(ac, op) : null;
          d.dest = ac.taxiDest && dests.find(x => x.v === ac.taxiDest.name) ? ac.taxiDest.name : (best || (dests.find(x => x.ok) || dests[0] || {}).v);
        }
        if (d.via == null) d.via = this.suggestVia(ac, d.dest) || '';
        h += `<div class="d-section"><h4>Ground – Rollfreigabe</h4>
          <div class="d-row"><label class="grow">Ziel<select data-f="dest">${dests.map(x => `<option value="${x.v}" ${x.v === d.dest ? 'selected' : ''}>${esc(x.t)}</option>`).join('')}</select></label></div>
          <div class="d-row"><label class="grow">Über (Rollwege)<input data-f="via" value="${esc(d.via)}" placeholder="z. B. G Z B"></label><button data-act="suggest" title="Route nach Standard-Rollrichtungen vorschlagen">Vorschlag</button></div>
          <p class="d-note" id="routeNote"></p>
          <div class="d-row"><button class="primary" data-act="taxi">Rollfreigabe erteilen</button></div></div>`;
      }
      if (s === 'TAXI' || s === 'AT_HP' || s === 'VACATING' || s === 'ARR_TX_REQ') {
        const rem = ac.remainingNodes();
        const twys = [...new Set(rem.flatMap(n => AP.namesOfNode(n)))].filter(n => AP.twyNames.includes(n));
        const near = sim.list.filter(o => o !== ac && o.onGround && o.visible && U.dist(o.x, o.y, ac.x, ac.y) < 900 && !['PRE', 'PARKED', 'CLR_REQ', 'CLR_RB', 'CLEARED', 'GND_WAIT'].includes(o.state))
          .sort((a, b) => U.dist(a.x, a.y, ac.x, ac.y) - U.dist(b.x, b.y, ac.x, ac.y));
        h += `<div class="d-section"><h4>Ground – Während des Rollens</h4>
          <div class="d-row"><button data-cmd="HOLD" class="${ac.holdPos ? '' : 'warn'}">Anhalten</button><button data-cmd="CONT">Weiterrollen</button></div>
          <div class="d-row"><select data-f="hs" class="grow">${twys.map(t => `<option>${t}</option>`).join('') || '<option value="">–</option>'}</select><button data-act="hs">Vor Rollweg halten</button></div>
          <div class="d-row"><select data-f="gw" class="grow">${near.map(o => `<option value="${o.cs}">${o.cs} (${o.type}, ${Math.round(U.dist(o.x, o.y, ac.x, ac.y))} m)</option>`).join('') || '<option value="">kein Verkehr in der Nähe</option>'}</select></div>
          <div class="d-row"><button data-act="gw">Vorfahrt gewähren</button><button data-act="fl">Folgen</button></div>`;
        if (ac.kind === 'dep' && ac.taxiDest && ac.taxiDest.type === 'hp') h += `<div class="d-row"><button class="primary" data-cmd="TWR">An Tower ${D.FREQ.TWR}</button></div>`;
        h += `</div>`;
      }
      return h;
    }

    suggestVia(ac, dest) {
      const sim = this.sim;
      const d = sim.parseDest(dest);
      if (!d) return '';
      const start = ac.routeStart();
      if (!start) return '';
      const r = AP.findRoute(start, d.node, null, { flow: sim.weather.opDir });
      if (!r) return '';
      const startName = start.from != null ? (AP.edgeBetween(start.from, start.to) || {}).name : null;
      return AP.viaFromNames(r.names, startName, d.node).join(' ');
    }

    updatePreview() {
      const sim = this.sim;
      const ac = this.selected ? sim.byId[this.selected] : null;
      const note = document.getElementById('routeNote');
      const destSel = document.querySelector('#detail [data-f="dest"]');
      if (!ac || !destSel) { this.app.renderer.preview = null; return; }
      const d = sim.parseDest(destSel.value);
      const viaEl = document.querySelector('#detail [data-f="via"]');
      const via = viaEl ? viaEl.value.toUpperCase().split(/[\s,]+/).filter(Boolean) : [];
      const start = ac.routeStart();
      let r = d && start ? AP.findRoute(start, d.node, via.length ? via : null, { flow: sim.weather.opDir }) : null;
      let tow = false;
      if (!r && d && start) { r = AP.findRoute(start, d.node, via.length ? via : null, { flow: sim.weather.opDir, allowReverse: true }); tow = !!(r && r.reversed); }
      if (!r) {
        this.app.renderer.preview = null;
        if (note) note.textContent = via.length ? 'Diese Route ist nicht fahrbar (Reihenfolge, Abbiegewinkel oder Rollweg prüfen).' : 'Keine Route gefunden.';
        return;
      }
      const pts = [{ x: ac.x, y: ac.y }, ...r.nodes.slice(1).map(n => ({ x: AP.nodes[n].x, y: AP.nodes[n].y }))];
      // Gegen die Standard-Richtung?
      let against = 0;
      for (let i = 0; i < r.nodes.length - 1; i++) { const e = AP.edgeBetween(r.nodes[i], r.nodes[i + 1]); if (e && AP.flowOf(e, r.nodes[i], r.nodes[i + 1], sim.weather.opDir) === false) against++; }
      this.app.renderer.preview = { pts, ok: !tow };
      if (note) note.textContent = `${Math.round(r.cost % 4000 > 0 ? routeLen(r) : routeLen(r))} m · Route: ${r.names.join(' – ')}${against ? ' · ⚠ teilweise gegen die Standard-Rollrichtung' : ''}${tow ? ' · ⚠ nur mit Schlepper möglich (Flugzeug muss wenden)' : ''}`;
      function routeLen(rt) { let L = 0; for (let i = 0; i < rt.nodes.length - 1; i++) { const a = AP.nodes[rt.nodes[i]], b = AP.nodes[rt.nodes[i + 1]]; L += U.dist(a.x, a.y, b.x, b.y); } return L; }
    }

    onDetailChange(e) {
      const f = e.target.dataset.f;
      if (!f) return;
      const ac = this.selected ? this.sim.byId[this.selected] : null;
      if (!ac) return;
      const d = this.draft(ac);
      if (f === 'dest') { d.dest = e.target.value; d.via = this.suggestVia(ac, d.dest); const v = document.querySelector('#detail [data-f="via"]'); if (v) v.value = d.via; }
      else if (f === 'via') d.via = e.target.value;
      else if (f === 'sid') d.sid = e.target.value;
      else if (f === 'alt') d.alt = +e.target.value;
      else if (f === 'sq') d.sq = e.target.value.trim();
      this.updatePreview();
    }

    onDetailClick(e) {
      const b = e.target.closest('button');
      if (!b) return;
      const ac = this.selected ? this.sim.byId[this.selected] : null;
      if (!ac) return;
      const val = (f) => { const el = document.querySelector(`#detail [data-f="${f}"]`); return el ? el.value : ''; };
      if (b.dataset.cmd) { this.run(ac.cs + ' ' + b.dataset.cmd); return; }
      const d = this.draft(ac);
      switch (b.dataset.act) {
        case 'clr': this.run(`${ac.cs} CLR ${val('sid')} ${val('alt')} ${val('sq')}`); break;
        case 'pbh': this.run(`${ac.cs} PBH ${val('pbmins')}`); break;
        case 'suggest': { d.via = this.suggestVia(ac, val('dest')); const v = document.querySelector('#detail [data-f="via"]'); if (v) v.value = d.via; this.updatePreview(); break; }
        case 'taxi': { const r = this.run(`${ac.cs} TX ${val('dest')} ${val('via') ? 'VIA ' + val('via') : ''}`); if (r.ok) { d.via = null; this.app.renderer.preview = null; } break; }
        case 'hs': if (val('hs')) this.run(`${ac.cs} HS ${val('hs')}`); break;
        case 'gw': if (val('gw')) this.run(`${ac.cs} GW ${val('gw')}`); break;
        case 'fl': if (val('gw')) this.run(`${ac.cs} FL ${val('gw')}`); break;
        case 'stand': if (val('stand')) this.run(`${ac.cs} STAND ${val('stand')}`); break;
      }
    }

    // ---------- Funk ----------
    addRadio(entry) {
      const box = $('radio');
      const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
      const div = document.createElement('div');
      let cls = 'r-line r-' + entry.from;
      if (entry.level) cls += ' ' + entry.level;
      div.className = cls;
      let who = '';
      if (entry.from === 'pilot') who = entry.ac;
      else if (entry.from === 'atc') who = D.ROLE_NAME[entry.pos] || 'Lotse';
      else if (entry.from === 'ai') who = (D.ROLE_NAME[entry.pos] || '') + ' (KI)';
      else if (entry.from === 'score') who = 'Wertung';
      else who = 'Info';
      div.innerHTML = `<span class="r-time">${U.hhmmss(entry.clock)}</span><span class="r-who">${esc(who)}</span><span class="r-text">${esc(entry.text)}</span>`;
      if (entry.ac && entry.from !== 'sys') { div.style.cursor = 'pointer'; div.addEventListener('click', () => this.sim.byId[entry.ac] && this.select(entry.ac, true)); }
      box.appendChild(div);
      while (box.children.length > 250) box.removeChild(box.firstChild);
      if (atBottom) box.scrollTop = box.scrollHeight;
      if ((entry.from === 'pilot' || entry.from === 'ai') && entry.speech && this.app.speed > 0 && this.app.speed <= 2) R.tts.speak(entry.speech, entry.seed || 7, entry.from === 'ai');
    }

    // ---------- Hilfe ----------
    showHelp() {
      const rows = Object.entries(CMD.DEFS).map(([k, d]) => `<tr><td>${esc(d.ex)}</td><td>${esc(d.help)}${d.pos ? ' <span class="muted">(' + D.ROLE_NAME[d.pos] + ')</span>' : ''}</td></tr>`).join('');
      $('helpBody').innerHTML = `
        <p>Du kannst alles per Klick im rechten Panel erledigen oder Befehle tippen. Das Rufzeichen kannst du weglassen, wenn ein Flugzeug ausgewählt ist. Mehrere Befehle lassen sich verketten: <b>LNX427 TX N8 VIA G Z B HS B</b>.</p>
        <table>${rows}</table>
        <h3>Ablauf eines Abflugs</h3>
        <ol><li>Pilot ruft Delivery: Freigabe mit SID, Höhe, Squawk erteilen (CLR).</li><li>Readback prüfen – stimmt alles? RBC. Sonst CLR erneut.</li><li>An Ground übergeben (GND).</li><li>Pilot will Pushback: Blickrichtung in Fahrtrichtung der Rollgasse wählen (PB E).</li><li>Nach dem Triebwerksstart: Rollfreigabe zu einem Holding Point der aktiven Betriebsrichtung (TX N8 VIA …).</li><li>Rechtzeitig an Tower übergeben (TWR) – Tower ist in Etappe 1 die KI.</li></ol>
        <h3>Ablauf einer Ankunft</h3>
        <ol><li>Tower übergibt nach dem Verlassen der Bahn: Übergabe annehmen (ACC).</li><li>Pilot meldet sich: zum Stand rollen lassen (TX 104 VIA …).</li><li>Bleibt ein Flugzeug zu lange vor dem Parallelrollweg stehen, blockiert es die Bahn – der nächste Anflug muss durchstarten.</li></ol>
        <h3>Wichtig</h3>
        <ul><li>Holding Points für Starts: Betriebsrichtung 27 → N8/N7/N6 bzw. S8/S7/S6, Betriebsrichtung 09 → N1/N2/N3 bzw. S1/S2/S3. Kreuzungen (N7, N6 …) haben weniger Startbahn – Großraumflugzeuge brauchen die volle Länge.</li>
        <li>Flugzeuge können nicht rückwärts rollen. Wer falsch steht, braucht einen Schlepper (kostet Zeit und Punkte).</li>
        <li>Piloten halten an, wenn vor ihnen Verkehr ist. Muss jemand wegen kreuzendem Verkehr oder Gegenverkehr anhalten, gilt das als Bodenkonflikt (−10). Plane mit HS (hold short), GW (give way) und den Standard-Rollrichtungen.</li>
        <li>Unbeantwortete Anfragen kosten nach 90 Sekunden Punkte.</li>
        <li>Bei Rückenwind über 5 kt wechselt die Betriebsrichtung. Danach brauchen schon freigegebene Abflüge eine neue SID.</li></ul>
        <h3>Steuerung</h3>
        <ul><li>Karte: Ziehen zum Verschieben, Mausrad zum Zoomen, Klick auf ein Flugzeug zum Auswählen.</li><li>Tab: nächstes Flugzeug, das auf dich wartet · Leertaste: Pause · Enter: Befehlszeile · Pfeil hoch: letzter Befehl · F1: diese Hilfe.</li></ul>`;
      $('help').hidden = false;
    }

    // ---------- Schichtende ----------
    showEnd() {
      const sim = this.sim;
      const pens = sim.log.filter(l => l.from === 'score' && l.level === 'bad');
      const avgDelay = sim.stats.delayN ? sim.stats.delaySum / sim.stats.delayN / 60 : 0;
      const title = sim.overReason === 'Kollision' ? 'Kollision – Schicht beendet' : 'Schicht beendet';
      let best = 0;
      try { best = +(localStorage.getItem('edlx-best') || 0); if (sim.overReason !== 'Kollision' && !sim.opts.tutorial && sim.score > best) { localStorage.setItem('edlx-best', String(sim.score)); } } catch (e) { /* kein Speicher */ }
      $('endBody').innerHTML = `
        <h2>${title}</h2>
        <p class="muted">${sim.overReason === 'Kollision' ? 'Zwei Flugzeuge sind zusammengestoßen. Am Boden hilft „Vorfahrt gewähren“ oder „Vor Rollweg halten“, bevor es eng wird.' : 'Zeit für die Übergabe an die nächste Schicht.'}</p>
        <div class="end-stats">
          <div><b>${sim.score}</b><span class="muted">Punkte${best && sim.score > best ? ' · neuer Rekord' : best ? ' · Rekord ' + best : ''}</span></div>
          <div><b>${sim.stats.dep}</b><span class="muted">Abflüge</span></div>
          <div><b>${sim.stats.arr}</b><span class="muted">Ankünfte</span></div>
          <div><b>${avgDelay.toFixed(1)} min</b><span class="muted">Ø Verspätung</span></div>
          <div><b>${sim.stats.conflicts}</b><span class="muted">Bodenkonflikte</span></div>
          <div><b>${sim.stats.goArounds}</b><span class="muted">Durchstarts</span></div>
        </div>
        ${pens.length ? `<h4>Abzüge</h4><div class="end-list">${pens.map(p => `<div>${U.hhmm(p.clock)} ${esc(p.text)}</div>`).join('')}</div>` : '<p>Keine Abzüge – sauber gearbeitet.</p>'}
        <div class="start-actions" style="margin-top:16px"><button class="primary" id="btnAgain">Neue Schicht</button></div>`;
      $('end').hidden = false;
      $('btnAgain').addEventListener('click', () => { $('end').hidden = true; this.app.showStart(); });
    }
  }

  ATC.UI = UI;
})(ATC);
