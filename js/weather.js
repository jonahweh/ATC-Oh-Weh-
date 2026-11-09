// Wetter, Betriebsrichtung, ATIS und Tageslicht.
(function (ATC) {
  const U = ATC.U;

  class Weather {
    // preset: 'random' | 'clear' | 'fog' | 'windshift' | 'mixed'
    constructor(rng, preset, clock0) {
      this.r = rng;
      this.preset = preset;
      this.windDir = 260 + U.range(rng, -25, 25);
      this.windSpd = U.range(rng, 5, 13);
      this.vis = 10000;
      this.qnh = Math.round(U.range(rng, 1008, 1026));
      this.temp = Math.round(U.range(rng, 2, 11));
      this.letterIdx = Math.floor(rng() * 6);
      this.opDir = 27;
      this.pendingChange = null;   // {at, to}
      this.windShiftAt = null;
      this.fogClearAt = null;
      this.t = 0;

      if (preset === 'random') {
        const roll = rng();
        this.preset = roll < 0.35 ? 'clear' : roll < 0.6 ? 'windshift' : roll < 0.8 ? 'fog' : 'mixed';
      }
      if (this.preset === 'fog' || this.preset === 'mixed') {
        this.vis = Math.round(U.range(rng, 250, 450) / 50) * 50;
        this.windSpd = U.range(rng, 2, 5);
        this.fogClearAt = U.range(rng, 15, 30) * 60;
      }
      if (this.preset === 'windshift' || this.preset === 'mixed') {
        this.windShiftAt = U.range(rng, 8, 16) * 60;
      }
      if (this.preset === 'windshift' && rng() < 0.5) this.windDir = (this.windDir + 180) % 360;
      this.opDir = this.headwind(27) >= this.headwind(9) ? 27 : 9;
      this.shiftTarget = null;
      this.prevOpDir = null; this.changedAt = -1e9;
    }

    headwind(opDir) { return this.windSpd * Math.cos(U.rad(this.windDir - (opDir === 27 ? 270 : 90))); }
    crosswind(opDir) { return Math.abs(this.windSpd * Math.sin(U.rad(this.windDir - (opDir === 27 ? 270 : 90)))); }
    get letter() { return String.fromCharCode(65 + (this.letterIdx % 26)); }
    get lvp() { return this.vis < 800; }

    update(dt, sim) {
      this.t += dt;
      const r = this.r;
      // langsame Zufallsbewegung
      this.windDir = (this.windDir + (r() - 0.5) * dt * 0.6 + 360) % 360;
      this.windSpd = U.clamp(this.windSpd + (r() - 0.5) * dt * 0.08, 1, 28);
      if (this.windShiftAt != null && this.t >= this.windShiftAt && this.shiftTarget == null) {
        this.shiftTarget = (this.windDir + 180) % 360;
        this.windSpd = Math.max(this.windSpd, 8);
      }
      if (this.shiftTarget != null) {
        const d = U.angDiff(this.windDir, this.shiftTarget);
        if (Math.abs(d) < 2) this.shiftTarget = null;
        else this.windDir = (this.windDir + Math.sign(d) * Math.min(Math.abs(d), dt * 0.35) + 360) % 360;
      }
      // Nebel
      const wasLvp = this.lvp;
      if (this.fogClearAt != null && this.t >= this.fogClearAt) {
        this.vis = Math.min(10000, this.vis + dt * 6);
        if (this.vis >= 10000) this.fogClearAt = null;
      }
      if (wasLvp !== this.lvp) this.newAtis(sim, this.lvp ? 'LVP aktiv' : 'LVP aufgehoben');

      // Betriebsrichtungswechsel bei Rückenwind > 5 kt
      if (!this.pendingChange && this.headwind(this.opDir) < -5) {
        const at = sim.t + 6 * 60;
        this.pendingChange = { at, to: this.opDir === 27 ? 9 : 27 };
        sim.event('sys', `Rückenwind auf Bahn ${this.opDir === 27 ? '27' : '09'} – Betriebsrichtungswechsel auf ${this.pendingChange.to === 27 ? '27' : '09'} um ${U.hhmm(sim.clock0 + at)}.`, 'warn');
      }
      if (this.pendingChange && sim.t >= this.pendingChange.at) {
        this.prevOpDir = this.opDir; this.changedAt = sim.t;
        this.opDir = this.pendingChange.to;
        this.pendingChange = null;
        this.newAtis(sim, `Betriebsrichtung ${this.opDir === 27 ? '27' : '09'}`);
        sim.onRunwayChange();
      }
      // regelmäßige ATIS-Aktualisierung (alle 30 Minuten)
      if (Math.floor((this.t - dt) / 1800) !== Math.floor(this.t / 1800)) this.newAtis(sim, 'Routine-Update');
    }

    newAtis(sim, reason) {
      this.letterIdx++;
      sim.event('sys', `Neue ATIS ${this.letter} (${reason}).`, 'info');
    }

    windText() {
      const d = String(Math.round(this.windDir / 10) * 10 || 360).padStart(3, '0');
      return d + '°/' + Math.round(this.windSpd) + 'kt';
    }
    visText() { return this.vis >= 9999 ? '10 km+' : this.vis >= 5000 ? Math.round(this.vis / 1000) + ' km' : Math.round(this.vis) + ' m'; }

    // 0 = Tag, 1 = Nacht (Bayern, November: SA ca. 07:15, SU ca. 16:40)
    darkness(clockSec) {
      const h = (clockSec / 3600) % 24;
      const sr = 7.25, ss = 16.67, tw = 0.6;
      if (h > sr + tw && h < ss - tw) return 0;
      if (h < sr - tw || h > ss + tw) return 1;
      if (h <= sr + tw) return U.clamp((sr + tw - h) / (2 * tw), 0, 1);
      return U.clamp((h - (ss - tw)) / (2 * tw), 0, 1);
    }
  }

  ATC.Weather = Weather;
})(ATC);
