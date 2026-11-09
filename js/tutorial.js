// Geführtes Tutorial: ein Abflug und eine Ankunft, Schritt für Schritt.
(function (ATC) {
  const T = {};

  T.scenario = function (sim) {
    const w = sim.weather;
    w.windDir = 265; w.windSpd = 8; w.vis = 10000; w.windShiftAt = null; w.fogClearAt = null; w.opDir = 27;
    const dep = sim.makeFlight('dep', 9 * 60, { airline: 'LNX', type: 'A20N', num: '427', long: false, place: ATC.D.DEST[0] });
    sim.pending.push({ kind: 'dep', at: 0, ac: dep });
    const arr = sim.makeFlight('arr', 12 * 60, { airline: 'PLW', type: 'B738', num: '512', long: false, place: ATC.D.DEST[13] });
    sim.pending.push({ kind: 'arr', at: 4 * 60, ac: arr });
    sim.forceStand = { LNX427: '104', PLW512: '203' };
  };

  T.steps = [
    { title: 'Willkommen bei Lindenau Ground', text: 'Du bist heute <b>Delivery</b> und <b>Ground</b>. Links siehst du alle Flüge, nach Position sortiert. Rechts erscheinen die Befehle für das gewählte Flugzeug, unten läuft der Funk mit. Tower und Anflug übernimmt die KI.', next: true },
    { title: 'Ein Pilot meldet sich', text: 'Gleich ruft <b>LNX427</b> („Linden 427“) und will seine Streckenfreigabe nach London. Sobald die Zeile in der Liste gelb wird, klicke sie an.', done: (s, ui) => ui.selected === 'LNX427' && s.byId.LNX427 && s.byId.LNX427.state === 'CLR_REQ' },
    { title: 'Streckenfreigabe erteilen', text: 'Rechts ist die Freigabe schon vorbereitet: SID <code>ROKAT1W</code> (Westen, Betriebsrichtung 27), Steigflug auf 5000 ft und ein Squawk-Code. Klicke <b>Freigabe erteilen</b>.', done: (s) => ['CLR_RB', 'CLEARED'].includes((s.byId.LNX427 || {}).state) },
    { title: 'Readback prüfen', text: 'Der Pilot liest die Freigabe zurück. Vergleiche SID, Höhe und Squawk mit dem, was du gesagt hast. Stimmt alles, klicke <b>Readback korrekt</b>. Stimmt etwas nicht, erteile die Freigabe einfach noch einmal.', done: (s) => { const a = s.byId.LNX427; return a && a.plan && !a.rbPending; } },
    { title: 'An Ground übergeben', text: 'Fertig mit Delivery. Klicke <b>An Ground 121.775</b>. Da du beide Positionen spielst, nimmst du die Übergabe automatisch an.', done: (s) => { const a = s.byId.LNX427; return a && (a.freq === 'GND' || ['GND_WAIT', 'PB_REQ'].includes(a.state)); } },
    { title: 'Pushback', text: 'Kurz vor der Abflugzeit bittet der Pilot um Pushback. In Betriebsrichtung 27 fließt der Verkehr auf der Rollgasse <code>G</code> nach Osten. Wähle deshalb <b>Pushback, Blick Osten</b>. (Tipp: der Knopf „Rollrichtungen“ oben zeigt alle Standardrichtungen.)', done: (s) => ['PUSHING', 'STARTUP', 'TAXI_REQ', 'TAXI'].includes((s.byId.LNX427 || {}).state) },
    { title: 'Warten auf „ready for taxi“', text: 'Ein Schlepper drückt das Flugzeug zurück, danach starten die Triebwerke. Mit <b>2×</b> oben kannst du die Zeit beschleunigen. Wenn der Pilot rollbereit ist, wird er wieder gelb.', done: (s) => ['TAXI_REQ', 'TAXI'].includes((s.byId.LNX427 || {}).state) },
    { title: 'Rollfreigabe', text: 'Die Routenhilfe wählt einen passenden Holding Point, hier <code>N6</code>: eine Kreuzung mit 3000 m Restbahn – genug für den A320neo (<code>N8</code> wäre die volle Länge). Die gestrichelte Linie zeigt die Route nach den Standard-Rollrichtungen. Klicke <b>Rollfreigabe erteilen</b>.', done: (s) => (s.byId.LNX427 || {}).state === 'TAXI' },
    { title: 'An Tower übergeben', text: 'Während das Flugzeug rollt, übergib es an den Tower: <b>An Tower 118.705</b>. Der Tower (KI) gibt dann die Startfreigabe, sobald die Bahn frei ist.', done: (s) => { const a = s.byId.LNX427; return s.stats.dep > 0 || !a ? s.stats.dep > 0 : a.freq === 'TWR' || (a.handoff && a.handoff.to === 'TWR') || ['TWR_HOLD', 'LINEUP', 'TAKEOFF', 'AIR'].includes(a.state); } },
    { title: 'Eine Ankunft', text: '<b>PLW512</b> landet gleich auf 27R. Nach dem Verlassen der Bahn übergibt der Tower an dich – die Zeile wird türkis. Klicke dann <b>Annehmen</b>.', done: (s) => { const a = s.byId.PLW512; return a && a.freq === 'GND'; } },
    { title: 'Zum Stand rollen', text: 'Der Pilot steht vor dem Rollweg <code>A</code> und möchte zu Stand 203. In Betriebsrichtung 27 führt die Standardroute über <code>A</code> nach Westen, über <code>N1</code> auf <code>B</code> und über <code>W</code> aufs Vorfeld. Das ist länger, vermeidet aber Gegenverkehr. Prüfe die Vorschau und erteile die Rollfreigabe.', done: (s) => { const a = s.byId.PLW512; return s.stats.arr > 0 || (!!a && (a.state === 'TAXI' || a.state === 'PARKED')); } },
    { title: 'Tippen geht schneller', text: 'Alles geht auch über die Befehlszeile unten. Probiere es: tippe <code>PLW512 HOLD</code> und Enter, danach <code>CONT</code>. Mit <b>F1</b> siehst du alle Befehle.', done: (s, ui, app) => app.typedCount >= 2, next: true },
    { title: 'Geschafft', text: 'Das sind die Grundlagen. In einer echten Schicht kommen Pilotenfehler, Nebel, Betriebsrichtungswechsel und Notfälle dazu. Viel Erfolg!', next: true, finish: true }
  ];

  class Tutorial {
    constructor(app) { this.app = app; this.i = 0; this.el = document.getElementById('tutorial'); }
    start() { this.i = 0; this.el.hidden = false; this.render(); }
    stop() { this.el.hidden = true; }
    render() {
      const st = T.steps[this.i];
      this.el.innerHTML = `<h4>${st.title}</h4><p>${st.text}</p><div class="tut-foot"><span class="muted small">Schritt ${this.i + 1} von ${T.steps.length}</span>
        ${st.next ? `<button class="primary" id="tutNext">${st.finish ? 'Zur Startseite' : 'Weiter'}</button>` : ''}</div>`;
      const b = document.getElementById('tutNext');
      if (b) b.addEventListener('click', () => { if (st.finish) { this.stop(); this.app.showStart(); } else this.advance(); });
    }
    advance() { this.i = Math.min(T.steps.length - 1, this.i + 1); this.render(); }
    update() {
      if (this.el.hidden) return;
      const a = this.app;
      // Wer schneller ist als das Tutorial, überspringt erledigte Schritte
      for (let j = T.steps.length - 1; j >= this.i; j--) {
        const st = T.steps[j];
        if (st.done && st.done(a.sim, a.ui, a)) { if (j + 1 > this.i) { this.i = Math.min(T.steps.length - 1, j + 1); this.render(); } break; }
      }
    }
  }

  ATC.TUT = T;
  ATC.Tutorial = Tutorial;
})(ATC);
