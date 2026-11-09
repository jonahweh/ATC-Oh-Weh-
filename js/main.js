// Startpunkt: verbindet Simulation, Karte und Oberfläche und betreibt die Spielschleife.
(function (ATC) {
  const $ = (id) => document.getElementById(id);

  class App {
    constructor() {
      this.renderer = new ATC.Renderer($('map'));
      this.ui = new ATC.UI(this);
      this.tutorial = new ATC.Tutorial(this);
      this.speed = 1;
      this.sim = null;
      this.typedCount = 0;
      ATC.R.tts.init();
      this.bindMap();
      this.bindKeys();
      this.bindStart();
      window.addEventListener('resize', () => this.renderer.resize());
      this.renderer.resize();
      this.renderer.fit();
      // Hintergrund-Simulation für den Startbildschirm
      this.newSim({ roles: { DEL: 'ai', GND: 'ai', TWR: 'ai', APP: 'ai' }, density: 32, weather: 'clear', clock0: 12 * 3600, duration: 99999, demo: true });
      this.last = performance.now();
      requestAnimationFrame((t) => this.loop(t));
    }

    newSim(opts) {
      this.sim = new ATC.Sim(opts);
      this.sim.on((ev, data) => {
        if (ev === 'log') this.ui.addRadio(data);
        if (ev === 'over') setTimeout(() => this.ui.showEnd(), 600);
        if (ev === 'runway') this.renderer.bgKey = '';
      });
      this.ui.reset();
      this.typedCount = 0;
      if (opts.demo) {
        // Demo vorspulen, damit schon Verkehr unterwegs ist
        for (let i = 0; i < 600; i++) this.sim.update(1);
      }
    }

    readOpts() {
      const v = (n) => document.querySelector(`input[name="${n}"]:checked`).value;
      return {
        roles: { DEL: v('del'), GND: v('gnd'), TWR: 'ai', APP: 'ai' },
        density: +v('dens'), clock0: +v('clock'), weather: v('wx'), duration: +v('dur'), errors: +v('err')
      };
    }

    bindStart() {
      $('btnStart').addEventListener('click', () => {
        const o = this.readOpts();
        this.ui.setTts(document.querySelector('input[name="tts"]:checked').value === '1');
        this.tutorial.stop();
        this.newSim(o);
        $('start').hidden = true;
        this.setSpeed(1);
        this.renderer.fit();
      });
      $('btnTutorial').addEventListener('click', () => {
        this.ui.setTts(document.querySelector('input[name="tts"]:checked').value === '1');
        this.newSim({ roles: { DEL: 'player', GND: 'player', TWR: 'ai', APP: 'ai' }, density: 0, weather: 'clear', clock0: 13 * 3600, duration: 99999, errors: 0, tutorial: true, seed: 42, scenario: ATC.TUT.scenario });
        $('start').hidden = true;
        this.setSpeed(1);
        this.view('north');
        this.tutorial.start();
      });
      let best = 0;
      try { best = +(localStorage.getItem('edlx-best') || 0); } catch (e) { /* egal */ }
      if (best) $('highscore').textContent = 'Dein Rekord: ' + best + ' Punkte';
    }

    showStart() {
      this.tutorial.stop();
      ATC.R.tts.stop();
      this.ui.setTts(false);
      this.newSim({ roles: { DEL: 'ai', GND: 'ai', TWR: 'ai', APP: 'ai' }, density: 32, weather: 'clear', clock0: 12 * 3600, duration: 99999, demo: true });
      $('start').hidden = false;
      this.setSpeed(1);
    }

    setSpeed(s) { this.speed = s; if (s === 0 || s > 2) ATC.R.tts.stop(); this.ui.renderTop(); }

    view(name) {
      const r = this.renderer;
      const areas = {
        all: { x0: -2350, x1: 2350, y0: -1000, y1: 1000 },
        north: { x0: -2150, x1: 2150, y0: 180, y1: 950 },
        south: { x0: -2150, x1: 2150, y0: -950, y1: -180 },
        apron: { x0: -2000, x1: 2000, y0: -520, y1: 520 }
      };
      r.fit(areas[name] || areas.all);
    }

    // ---------- Karte: Maus ----------
    bindMap() {
      const cv = $('map');
      let drag = null;
      cv.addEventListener('mousedown', (e) => { drag = { x: e.clientX, y: e.clientY, cx: this.renderer.cam.x, cy: this.renderer.cam.y, moved: false }; });
      window.addEventListener('mousemove', (e) => {
        if (!drag) return;
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) { drag.moved = true; cv.classList.add('dragging'); }
        if (drag.moved) {
          this.renderer.cam.x = drag.cx - dx / this.renderer.cam.scale;
          this.renderer.cam.y = drag.cy + dy / this.renderer.cam.scale;
        }
      });
      window.addEventListener('mouseup', (e) => {
        if (!drag) return;
        cv.classList.remove('dragging');
        if (!drag.moved && e.target === cv) {
          const rect = cv.getBoundingClientRect();
          const hit = this.renderer.hitTest(this.sim, e.clientX - rect.left, e.clientY - rect.top);
          if (hit) this.ui.select(hit, false);
        }
        drag = null;
      });
      cv.addEventListener('wheel', (e) => {
        e.preventDefault();
        const rect = cv.getBoundingClientRect();
        this.renderer.zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.15 : 1 / 1.15);
      }, { passive: false });
      // Touch: einfaches Verschieben
      let t0 = null;
      cv.addEventListener('touchstart', (e) => { if (e.touches.length === 1) t0 = { x: e.touches[0].clientX, y: e.touches[0].clientY, cx: this.renderer.cam.x, cy: this.renderer.cam.y }; }, { passive: true });
      cv.addEventListener('touchmove', (e) => { if (t0 && e.touches.length === 1) { this.renderer.cam.x = t0.cx - (e.touches[0].clientX - t0.x) / this.renderer.cam.scale; this.renderer.cam.y = t0.cy + (e.touches[0].clientY - t0.y) / this.renderer.cam.scale; } }, { passive: true });
    }

    bindKeys() {
      window.addEventListener('keydown', (e) => {
        const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName);
        if (e.key === 'F1') { e.preventDefault(); this.ui.showHelp(); return; }
        if (!$('start').hidden) return;
        if (e.key === 'Escape') { $('help').hidden = true; if (!typing) { this.ui.select(null); } return; }
        if (typing) return;
        if (e.key === ' ') { e.preventDefault(); this.setSpeed(this.speed === 0 ? (this.prevSpeed || 1) : (this.prevSpeed = this.speed, 0)); }
        else if (e.key === 'Enter') { e.preventDefault(); $('cmd').focus(); }
        else if (e.key === 'Tab') {
          e.preventDefault();
          const list = this.sim.list.filter(a => this.sim.needsAction(a)).sort((a, b) => (a.waitSince || 0) - (b.waitSince || 0));
          if (list.length) { const i = list.findIndex(a => a.cs === this.ui.selected); this.ui.select(list[(i + 1) % list.length].cs, true); }
        } else if (e.key === '+' || e.key === '=') this.renderer.zoomAt(this.renderer.w / 2, this.renderer.h / 2, 1.2);
        else if (e.key === '-') this.renderer.zoomAt(this.renderer.w / 2, this.renderer.h / 2, 1 / 1.2);
        else if (/^[a-zA-Z0-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey) { $('cmd').focus(); }
      });
    }

    loop(t) {
      const dt = Math.min(0.25, (t - this.last) / 1000);
      this.last = t;
      const sim = this.sim;
      const sp = $('start').hidden ? this.speed : 1;
      if (sim && !sim.over && sp > 0) sim.update(dt * sp);
      if (sim) {
        this.renderer.render(sim, this.ui);
        this.ui.renderTop();
        this.ui.renderList();
        this.ui.renderDetail();
        this.tutorial.update();
      }
      requestAnimationFrame((tt) => this.loop(tt));
    }
  }

  window.addEventListener('DOMContentLoaded', () => { ATC.app = new App(); });
})(ATC);
