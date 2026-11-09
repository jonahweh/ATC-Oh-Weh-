// Darstellung der Flughafenkarte auf einem Canvas: "gemalter" 2D-Stil.
(function (ATC) {
  const U = ATC.U, AP = ATC.AP, D = ATC.D;
  const G = AP.geo;

  const COL = {
    grass: '#6f9450', grassDark: '#5f8443', grassLight: '#80a45d',
    field: ['#8aa45a', '#a3a85f', '#7f9a4b', '#b3a66a', '#6e8f46', '#9fb06c'],
    apron: '#b7b6b0', apronLine: '#a6a59f', asphalt: '#55585e', shoulder: '#8d8f88',
    rwy: '#3f4247', rwyShoulder: '#7d7f79', white: '#f4f4f0', yellow: '#f2c230',
    roof: '#d8dbdf', roofDark: '#b9bec4', glass: '#7fa7c4', shadow: 'rgba(20,28,20,0.28)',
    tree: ['#3f6b35', '#4a7a3c', '#365e2f', '#567f3f'], road: '#8a8a86', water: '#6f9fb3'
  };

  class Renderer {
    constructor(canvas) {
      this.cv = canvas; this.ctx = canvas.getContext('2d');
      this.cam = { x: 0, y: 0, scale: 0.3 };
      this.dpr = 1;
      this.bg = document.createElement('canvas');
      this.bgKey = '';
      this.hover = null;
      this.preview = null;           // {pts:[{x,y}], ok}
      this.showFlows = false;
      this.buildDecor();
      this.grassPattern = this.makeGrassTexture();
    }

    resize() {
      const r = this.cv.getBoundingClientRect();
      this.dpr = Math.min(2, window.devicePixelRatio || 1);
      this.cv.width = Math.max(10, Math.round(r.width * this.dpr));
      this.cv.height = Math.max(10, Math.round(r.height * this.dpr));
      this.w = r.width; this.h = r.height;
      this.bgKey = '';
    }

    fit(area) {
      const a = area || { x0: -2350, x1: 2350, y0: -1000, y1: 1000 };
      this.cam.x = (a.x0 + a.x1) / 2; this.cam.y = (a.y0 + a.y1) / 2;
      this.cam.scale = Math.min(this.w / (a.x1 - a.x0), this.h / (a.y1 - a.y0));
    }

    // Welt <-> Bildschirm (CSS-Pixel)
    sx(x) { return this.w / 2 + (x - this.cam.x) * this.cam.scale; }
    sy(y) { return this.h / 2 - (y - this.cam.y) * this.cam.scale; }
    wx(px) { return this.cam.x + (px - this.w / 2) / this.cam.scale; }
    wy(py) { return this.cam.y - (py - this.h / 2) / this.cam.scale; }

    zoomAt(px, py, f) {
      const wx = this.wx(px), wy = this.wy(py);
      this.cam.scale = U.clamp(this.cam.scale * f, 0.06, 4);
      this.cam.x = wx - (px - this.w / 2) / this.cam.scale;
      this.cam.y = wy + (py - this.h / 2) / this.cam.scale;
    }

    // ---------- Deko (einmalig, deterministisch) ----------
    buildDecor() {
      const r = U.rng(4711);
      this.fields = [];
      for (let gx = -7000; gx < 7000; gx += 420 + r() * 200) {
        for (let gy = -4200; gy < 4200; gy += 380 + r() * 200) {
          if (Math.abs(gx + 200) < 2900 && Math.abs(gy + 200) < 1450) continue;
          this.fields.push({ x: gx, y: gy, w: 360 + r() * 260, h: 320 + r() * 240, c: U.pick(r, COL.field), rot: (r() - 0.5) * 0.08, rows: r() < 0.6 });
        }
      }
      this.trees = [];
      const addCluster = (cx, cy, n, rad) => {
        for (let i = 0; i < n; i++) {
          const a = r() * Math.PI * 2, d = Math.sqrt(r()) * rad;
          this.trees.push({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, r: 7 + r() * 9, c: U.pick(r, COL.tree) });
        }
      };
      for (let i = 0; i < 70; i++) {
        let x, y;
        do { x = (r() - 0.5) * 12000; y = (r() - 0.5) * 7000; } while (Math.abs(x) < 2850 && Math.abs(y) < 1400);
        addCluster(x, y, 8 + Math.floor(r() * 30), 60 + r() * 140);
      }
      // Baumreihen entlang des Zauns
      for (let x = -2800; x <= 2800; x += 34 + r() * 30) { if (r() < 0.7) this.trees.push({ x, y: 1330 + r() * 20, r: 8 + r() * 6, c: U.pick(r, COL.tree) }); if (r() < 0.7) this.trees.push({ x, y: -1330 - r() * 20, r: 8 + r() * 6, c: U.pick(r, COL.tree) }); }
      this.ponds = [{ x: -3400, y: 1900, rx: 260, ry: 130 }, { x: 3900, y: -2100, rx: 200, ry: 120 }];
    }

    makeGrassTexture() {
      const c = document.createElement('canvas'); c.width = c.height = 256;
      const g = c.getContext('2d');
      g.fillStyle = COL.grass; g.fillRect(0, 0, 256, 256);
      const r = U.rng(99);
      for (let i = 0; i < 900; i++) {
        g.fillStyle = r() < 0.5 ? 'rgba(255,255,220,0.05)' : 'rgba(20,50,10,0.06)';
        const x = r() * 256, y = r() * 256, s = 3 + r() * 16;
        g.beginPath(); g.ellipse(x, y, s, s * (0.4 + r() * 0.6), r() * 3, 0, Math.PI * 2); g.fill();
      }
      return this.ctx.createPattern(c, 'repeat');
    }

    // ---------- Statischer Hintergrund (gecacht) ----------
    drawStatic(ctx, dark) {
      const s = this.cam.scale;
      const X = (x) => this.sx(x), Y = (y) => this.sy(y);
      // Gras mit Textur, an der Welt verankert
      try {
        const m = new DOMMatrix().translate(X(0), Y(0)).scale(Math.max(0.6, s * 2.2));
        this.grassPattern.setTransform(m);
      } catch (e) { /* ältere Browser */ }
      ctx.fillStyle = this.grassPattern; ctx.fillRect(0, 0, this.w, this.h);

      // Felder außerhalb des Zauns
      for (const f of this.fields) {
        ctx.save(); ctx.translate(X(f.x + f.w / 2), Y(f.y + f.h / 2)); ctx.rotate(f.rot);
        ctx.fillStyle = f.c; ctx.globalAlpha = 0.85;
        ctx.fillRect(-f.w / 2 * s, -f.h / 2 * s, f.w * s, f.h * s);
        if (f.rows && s > 0.12) {
          ctx.globalAlpha = 0.12; ctx.strokeStyle = '#2f3a1c'; ctx.lineWidth = 1;
          ctx.beginPath();
          for (let k = -f.w / 2; k < f.w / 2; k += 18) { ctx.moveTo(k * s, -f.h / 2 * s); ctx.lineTo(k * s, f.h / 2 * s); }
          ctx.stroke();
        }
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      for (const p of this.ponds) { ctx.fillStyle = COL.water; ctx.beginPath(); ctx.ellipse(X(p.x), Y(p.y), p.rx * s, p.ry * s, 0.3, 0, Math.PI * 2); ctx.fill(); }

      // Flughafengelände (gemähter Rasen) mit Mähstreifen entlang der Bahnen
      ctx.fillStyle = COL.grassLight; ctx.globalAlpha = 0.35;
      this.rect(ctx, -2700, -1280, 5400, 2560); ctx.globalAlpha = 1;
      for (const rw of [AP.runways.N, AP.runways.S]) {
        for (let k = -6; k < 6; k++) {
          ctx.fillStyle = k % 2 ? 'rgba(255,255,230,0.06)' : 'rgba(30,60,20,0.05)';
          this.rect(ctx, -2300, rw.y + k * 28, 4600, 28);
        }
      }
      // Zaun & Ringstraße
      ctx.strokeStyle = COL.road; ctx.lineWidth = Math.max(1, 7 * s);
      ctx.strokeRect(X(-2760), Y(1310), 5520 * s, 2620 * s);
      ctx.strokeStyle = 'rgba(60,60,60,0.5)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.strokeRect(X(-2720), Y(1290), 5440 * s, 2580 * s); ctx.setLineDash([]);
      // Zufahrtsstraße von Westen
      ctx.strokeStyle = COL.road; ctx.lineWidth = Math.max(1.5, 14 * s);
      ctx.beginPath(); ctx.moveTo(X(-8000), Y(-60)); ctx.lineTo(X(-2760), Y(-60)); ctx.stroke();

      // Bäume (mit Schatten)
      const tv = s > 0.07;
      if (tv) {
        ctx.fillStyle = 'rgba(20,35,15,0.3)';
        for (const t of this.trees) { ctx.beginPath(); ctx.arc(X(t.x + 4), Y(t.y - 4), t.r * s, 0, Math.PI * 2); ctx.fill(); }
        for (const t of this.trees) {
          ctx.fillStyle = t.c; ctx.beginPath(); ctx.arc(X(t.x), Y(t.y), t.r * s, 0, Math.PI * 2); ctx.fill();
          if (s > 0.25) { ctx.fillStyle = 'rgba(255,255,200,0.12)'; ctx.beginPath(); ctx.arc(X(t.x - t.r * 0.3), Y(t.y + t.r * 0.3), t.r * 0.5 * s, 0, Math.PI * 2); ctx.fill(); }
        }
      }

      // Vorfeldflächen
      ctx.fillStyle = COL.apron;
      this.rect(ctx, -1760, 330, 3520, 100); this.rect(ctx, -1760, -430, 3520, 100);           // Rollgassen
      for (const [x0, x1] of [G.T1, G.T2]) { this.rect(ctx, x0 - 40, 140, x1 - x0 + 80, 200); this.rect(ctx, x0 - 40, -340, x1 - x0 + 80, 200); }
      this.rect(ctx, G.T1[1], -230, G.T2[0] - G.T1[1], 460);                                   // Mitte (Tower)
      this.rect(ctx, -1960, -360, 300, 720); this.rect(ctx, 1660, -360, 300, 720);             // Remote & Cargo
      // Fugen im Beton
      if (s > 0.35) {
        ctx.strokeStyle = COL.apronLine; ctx.lineWidth = 1; ctx.beginPath();
        for (let x = -1760; x <= 1760; x += 25) { for (const [y0, y1] of [[330, 430], [-430, -330]]) { ctx.moveTo(X(x), Y(y0)); ctx.lineTo(X(x), Y(y1)); } }
        for (let y = 330; y <= 430; y += 25) { ctx.moveTo(X(-1760), Y(y)); ctx.lineTo(X(1760), Y(y)); ctx.moveTo(X(-1760), Y(-y)); ctx.lineTo(X(1760), Y(-y)); }
        ctx.stroke();
      }

      // Rollwege: Schulter, Belag
      const twyEdges = AP.edges.filter(e => e.kind === 'twy' || e.kind === 'rwyconn');
      const strokeEdges = (list, width, color) => {
        ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, width * s); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath();
        for (const e of list) { const a = AP.nodes[e.a], b = AP.nodes[e.b]; ctx.moveTo(X(a.x), Y(a.y)); ctx.lineTo(X(b.x), Y(b.y)); }
        ctx.stroke();
      };
      strokeEdges(twyEdges, 44, COL.shoulder);
      strokeEdges(twyEdges, G.twyWidth, COL.asphalt);
      // Rundungen an Kreuzungen (Fillets)
      ctx.fillStyle = COL.asphalt;
      for (const id in AP.junction) {
        const n = AP.nodes[id];
        if (n.type === 'lane') continue;
        ctx.beginPath(); ctx.arc(X(n.x), Y(n.y), 26 * s, 0, Math.PI * 2); ctx.fill();
      }

      // Bahnen
      for (const rw of [AP.runways.N, AP.runways.S]) this.drawRunway(ctx, rw);

      // Rollweg-Mittellinien & Holding-Point-Markierungen
      if (s > 0.12) {
        ctx.strokeStyle = COL.yellow; ctx.lineWidth = Math.max(0.8, 0.9 * s);
        const ce = AP.edges.filter(e => e.kind === 'twy' || e.kind === 'lane' || e.kind === 'stand');
        ctx.beginPath();
        for (const e of ce) { const a = AP.nodes[e.a], b = AP.nodes[e.b]; ctx.moveTo(X(a.x), Y(a.y)); ctx.lineTo(X(b.x), Y(b.y)); }
        ctx.stroke();
        for (const name of AP.hpNames) this.drawHoldLine(ctx, AP.hps[name]);
      }

      // Stand-Markierungen
      if (s > 0.25) {
        ctx.fillStyle = COL.yellow; ctx.font = `600 ${Math.max(9, 13 * s)}px 'Barlow Condensed', sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        for (const id of AP.standIds) {
          const st = AP.stands[id];
          const d = U.dirVec(st.noseHdg);
          // Stopplinie
          const px = -d.y, py = d.x;
          ctx.strokeStyle = COL.yellow; ctx.lineWidth = Math.max(1, 1.2 * s);
          ctx.beginPath(); ctx.moveTo(X(st.x + px * 5), Y(st.y + py * 5)); ctx.lineTo(X(st.x - px * 5), Y(st.y - py * 5)); ctx.stroke();
          ctx.fillText(id, X(st.x - d.x * 60 + px * 0), Y(st.y - d.y * 60));
        }
      }

      // Gebäude
      this.drawBuildings(ctx);

      // Rollweg-Schilder
      if (s > 0.28) this.drawSigns(ctx);
      if (this.showFlows) this.drawFlows(ctx);
    }

    rect(ctx, x, y, w, h) { ctx.fillRect(this.sx(x), this.sy(y + h), w * this.cam.scale, h * this.cam.scale); }

    drawRunway(ctx, rw) {
      const s = this.cam.scale, X = (x) => this.sx(x), Y = (y) => this.sy(y);
      const L = G.rwyHalfLen, W = G.rwyWidth;
      ctx.fillStyle = COL.rwyShoulder; this.rect(ctx, -L - 60, rw.y - W / 2 - 8, 2 * L + 120, W + 16);
      ctx.fillStyle = COL.rwy; this.rect(ctx, -L, rw.y - W / 2, 2 * L, W);
      // Blast pads mit Chevrons
      for (const sgn of [-1, 1]) {
        ctx.fillStyle = '#5a5c5f'; this.rect(ctx, sgn > 0 ? L : -L - 60, rw.y - W / 2, 60, W);
        if (s > 0.2) {
          ctx.strokeStyle = COL.yellow; ctx.lineWidth = Math.max(1, 2 * s); ctx.beginPath();
          for (let k = 10; k < 60; k += 18) {
            const x0 = sgn * (L + k);
            ctx.moveTo(X(x0 + sgn * 14), Y(rw.y + W / 2 - 3)); ctx.lineTo(X(x0), Y(rw.y)); ctx.lineTo(X(x0 + sgn * 14), Y(rw.y - W / 2 + 3));
          }
          ctx.stroke();
        }
      }
      if (s < 0.08) return;
      ctx.fillStyle = COL.white;
      // Seitenstreifen
      this.rect(ctx, -L, rw.y + W / 2 - 1.5, 2 * L, 0.9); this.rect(ctx, -L, rw.y - W / 2 + 0.6, 2 * L, 0.9);
      // Mittellinie
      for (let x = -L + 180; x < L - 180; x += 60) this.rect(ctx, x, rw.y - 0.45, 36, 0.9);
      for (const sgn of [-1, 1]) {
        const thr = sgn * L;
        const inward = -sgn;
        // Piano keys
        for (let k = 0; k < 8; k++) {
          const off = 3 + k * 3.6;
          this.rect(ctx, inward > 0 ? thr + 6 : thr - 6 - 30, rw.y + off, 30, 1.8);
          this.rect(ctx, inward > 0 ? thr + 6 : thr - 6 - 30, rw.y - off - 1.8, 30, 1.8);
        }
        // Aufsetzzone & Zielpunkt
        const aim = thr + inward * 400;
        this.rect(ctx, inward > 0 ? aim - 22 : aim - 23, rw.y + 6, 45, 10);
        this.rect(ctx, inward > 0 ? aim - 22 : aim - 23, rw.y - 16, 45, 10);
        for (const d of [150, 300, 600, 750, 900]) {
          const tx = thr + inward * d;
          for (const yy of [8, 12]) { this.rect(ctx, tx - 11, rw.y + yy, 22, 1.8); this.rect(ctx, tx - 11, rw.y - yy - 1.8, 22, 1.8); }
        }
        // Bahnbezeichnung
        if (s > 0.18) {
          const name = sgn < 0 ? rw.names[9] : rw.names[27];
          ctx.save(); ctx.translate(X(thr + inward * 62), Y(rw.y)); ctx.rotate(sgn < 0 ? Math.PI / 2 : -Math.PI / 2);
          ctx.fillStyle = COL.white; ctx.font = `700 ${18 * s}px 'Barlow Condensed', sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(name.slice(0, 2), 0, -6 * s); ctx.fillText(name.slice(2), 0, 12 * s);
          ctx.restore();
        }
      }
    }

    drawHoldLine(ctx, hp) {
      const s = this.cam.scale, X = (x) => this.sx(x), Y = (y) => this.sy(y);
      const sgn = hp.y > 0 ? 1 : -1;
      ctx.fillStyle = COL.yellow;
      // zwei durchgezogene Linien (Rollwegseite), zwei gestrichelte (Bahnseite)
      for (const k of [0, 1]) this.rect(ctx, hp.x - 13, hp.y - sgn * (2 + k * 1.6) - 0.4, 26, 0.6);
      for (const k of [0, 1]) for (let x = -13; x < 13; x += 3.4) this.rect(ctx, hp.x + x, hp.y + sgn * (1.2 + k * 1.6) - 0.4, 2, 0.6);
      void X; void Y; void s;
    }

    drawBuildings(ctx) {
      const s = this.cam.scale, X = (x) => this.sx(x), Y = (y) => this.sy(y);
      const building = (x0, y0, x1, y1, roof, label) => {
        ctx.fillStyle = COL.shadow; ctx.fillRect(X(x0 + 8), Y(y1 - 8), (x1 - x0) * s, (y1 - y0) * s);
        ctx.fillStyle = roof; ctx.fillRect(X(x0), Y(y1), (x1 - x0) * s, (y1 - y0) * s);
        if (label && s > 0.12) {
          ctx.fillStyle = 'rgba(70,80,90,0.35)'; ctx.font = `700 ${Math.max(10, 60 * s)}px 'Barlow Condensed', sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, X((x0 + x1) / 2), Y((y0 + y1) / 2));
        }
      };
      for (const [x0, x1, nm] of [[G.T1[0], G.T1[1], 'T1'], [G.T2[0], G.T2[1], 'T2']]) {
        const H = G.termHalfH;
        // Innenhöfe (begrünte Dächer) zwischen Pier und Haupthalle
        ctx.fillStyle = '#7d9a68'; ctx.fillRect(X(x0 + 20), Y(H - 70), (x1 - x0 - 40) * s, (2 * H - 140) * s);
        // Piers an beiden Vorfeldseiten
        building(x0, H - 70, x1, H, COL.roof);
        building(x0, -H, x1, -H + 70, COL.roof);
        // Haupthalle mit Verbindungsgängen
        building(x0 + 60, -70, x1 - 60, 70, '#cfd3d8', nm);
        for (const cx of [x0 + 90, (x0 + x1) / 2, x1 - 90]) { building(cx - 18, 70, cx + 18, H - 70, COL.roof); building(cx - 18, -H + 70, cx + 18, -70, COL.roof); }
        if (s > 0.15) {
          ctx.strokeStyle = COL.roofDark; ctx.lineWidth = Math.max(1, 2 * s); ctx.beginPath();
          for (let x = x0 + 25; x < x1; x += 50) { ctx.moveTo(X(x), Y(H - 10)); ctx.lineTo(X(x), Y(H - 60)); ctx.moveTo(X(x), Y(-H + 10)); ctx.lineTo(X(x), Y(-H + 60)); }
          ctx.stroke();
          ctx.fillStyle = '#9aa1a8';
          for (let x = x0 + 120; x < x1 - 100; x += 150) { ctx.fillRect(X(x), Y(30), 26 * s, 16 * s); ctx.fillRect(X(x + 40), Y(-10), 14 * s, 14 * s); }
          ctx.fillStyle = COL.glass; ctx.fillRect(X(x0), Y(H), (x1 - x0) * s, Math.max(1, 3 * s)); ctx.fillRect(X(x0), Y(-H + 3), (x1 - x0) * s, Math.max(1, 3 * s));
        }
      }
      // Fluggastbrücken
      if (s > 0.15) {
        for (const id of AP.standIds) {
          const st = AP.stands[id];
          if (st.area !== 'T1' && st.area !== 'T2') continue;
          const sg = st.y > 0 ? 1 : -1;
          const fx = st.x + 16, fy = sg * G.termHalfH, tx = st.x + 3.5, ty = st.y + sg * 7;
          ctx.strokeStyle = '#8e959c'; ctx.lineWidth = Math.max(1.5, 4.5 * s); ctx.lineCap = 'butt';
          ctx.beginPath(); ctx.moveTo(X(fx), Y(fy)); ctx.lineTo(X(tx), Y(ty)); ctx.stroke();
          ctx.fillStyle = '#6f767d'; ctx.fillRect(X(tx) - 3 * s, Y(ty) - 3 * s, 6 * s, 6 * s);
        }
      }
      // Tower
      ctx.fillStyle = COL.shadow; ctx.beginPath(); ctx.arc(X(158), Y(-8), 16 * s, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#e9ecef'; ctx.beginPath(); ctx.arc(X(150), Y(0), 16 * s, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#5c8bb0'; ctx.beginPath(); ctx.arc(X(150), Y(0), 11 * s, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#d0d5da'; ctx.beginPath(); ctx.arc(X(150), Y(0), 6 * s, 0, Math.PI * 2); ctx.fill();
      // Feuerwache, Cargo-Hallen, Parkhaus
      building(-2380, -60, -2200, 60, '#c56a5a');
      building(2020, -320, 2260, -40, '#c9c3b5'); building(2020, 40, 2260, 320, '#c9c3b5');
      building(-160, -180, -40, -60, '#a7adb3');
    }

    drawSigns(ctx) {
      const s = this.cam.scale, X = (x) => this.sx(x), Y = (y) => this.sy(y);
      const fs = U.clamp(12 * s + 4, 9, 14);
      ctx.font = `700 ${fs}px 'Barlow Condensed', sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const done = new Set();
      const sign = (x, y, txt, red) => {
        const w = ctx.measureText(txt).width + 6, h = fs + 2;
        ctx.fillStyle = red ? '#b5281f' : '#1c1c1c'; ctx.fillRect(x - w / 2, y - h / 2, w, h);
        ctx.fillStyle = red ? '#ffffff' : COL.yellow; ctx.fillText(txt, x, y + 0.5);
      };
      for (const e of AP.edges) {
        if (e.kind !== 'twy' && e.kind !== 'lane') continue;
        if (e.glue || /^[NS]\d$/.test(e.name)) continue;
        const a = AP.nodes[e.a], b = AP.nodes[e.b];
        if (e.len < (s > 0.6 ? 80 : 300)) continue;
        const key = e.name + Math.round((a.x + b.x) / (s > 0.6 ? 300 : 900)) + '_' + Math.round((a.y + b.y) / 500);
        if (done.has(key)) continue; done.add(key);
        const horiz = Math.abs(b.x - a.x) > Math.abs(b.y - a.y);
        sign(X((a.x + b.x) / 2) + (horiz ? 0 : 16), Y((a.y + b.y) / 2) + (horiz ? -16 : 0), e.name);
      }
      for (const n of AP.hpNames) {
        const hp = AP.hps[n];
        const sg = hp.y > 0 ? 1 : -1;
        sign(X(hp.x) - 22, Y(hp.y - sg * 18), n, false);
        if (s > 0.35) sign(X(hp.x) + 26, Y(hp.y - sg * 18), AP.runways[hp.rwy].names[9] + '-' + AP.runways[hp.rwy].names[27], true);
      }
    }

    drawFlows(ctx) {
      const op = this.flowDir || 27;
      const X = (x) => this.sx(x), Y = (y) => this.sy(y);
      ctx.fillStyle = 'rgba(80,200,230,0.85)';
      for (const e of AP.edges) {
        if (e.kind !== 'twy' && e.kind !== 'lane') continue;
        const f = AP.flowOf(e, e.a, e.b, op);
        if (f == null) continue;
        const [from, to] = f ? [e.a, e.b] : [e.b, e.a];
        const a = AP.nodes[from], b = AP.nodes[to];
        const mx = X((a.x + b.x) / 2), my = Y((a.y + b.y) / 2);
        const ang = Math.atan2(Y(b.y) - Y(a.y), X(b.x) - X(a.x));
        ctx.save(); ctx.translate(mx, my); ctx.rotate(ang);
        ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-5, -5); ctx.lineTo(-2, 0); ctx.lineTo(-5, 5); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }

    // ---------- Nachtbeleuchtung ----------
    drawLights(ctx, dark) {
      if (dark < 0.15) return;
      const s = this.cam.scale, X = (x) => this.sx(x), Y = (y) => this.sy(y);
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.min(1, dark * 1.2);
      const dot = (x, y, c, r) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(X(x), Y(y), r, 0, Math.PI * 2); ctx.fill(); };
      // Vorfeld-Flutlicht
      for (const yy of [330, -330]) for (let x = -1700; x <= 1700; x += 140) {
        const gx = X(x), gy = Y(yy);
        const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, 110 * s);
        g.addColorStop(0, 'rgba(255,220,160,0.22)'); g.addColorStop(1, 'rgba(255,220,160,0)');
        ctx.fillStyle = g; ctx.fillRect(gx - 110 * s, gy - 110 * s, 220 * s, 220 * s);
      }
      const r1 = Math.max(1, 1.6 * Math.min(1, s * 2));
      for (const rw of [AP.runways.N, AP.runways.S]) {
        for (let x = -G.rwyHalfLen; x <= G.rwyHalfLen; x += 60) { dot(x, rw.y + 31, '#fff6dd', r1); dot(x, rw.y - 31, '#fff6dd', r1); }
        for (let x = -G.rwyHalfLen + 30; x < G.rwyHalfLen; x += 30) dot(x, rw.y, 'rgba(255,255,255,0.55)', r1 * 0.8);
        for (let k = -28; k <= 28; k += 4) { dot(-G.rwyHalfLen, rw.y + k, '#57ff7a', r1); dot(G.rwyHalfLen, rw.y + k, '#57ff7a', r1); }
      }
      if (s > 0.1) {
        for (const e of AP.edges) {
          if (e.kind !== 'twy') continue;
          const a = AP.nodes[e.a], b = AP.nodes[e.b];
          const n = Math.max(1, Math.floor(e.len / 30));
          for (let i = 0; i <= n; i++) { const t = i / n; dot(U.lerp(a.x, b.x, t), U.lerp(a.y, b.y, t), 'rgba(90,255,140,0.75)', r1 * 0.8); }
        }
        for (const n of AP.hpNames) { const hp = AP.hps[n]; for (let k = -10; k <= 10; k += 4) dot(hp.x + k, hp.y, '#ffcc33', r1); }
      }
      // Terminal-Fenster
      ctx.fillStyle = 'rgba(255,214,140,0.35)';
      for (const [x0, x1] of [G.T1, G.T2]) { ctx.fillRect(X(x0), Y(G.termHalfH), (x1 - x0) * s, Math.max(1, 5 * s)); ctx.fillRect(X(x0), Y(-G.termHalfH + 5), (x1 - x0) * s, Math.max(1, 5 * s)); }
      ctx.restore();
    }

    // ---------- Flugzeuge ----------
    drawAircraft(ctx, ac, opts) {
      const T = ac.T, L = T.len, S = T.span;
      const k = Math.max(this.cam.scale, 0.42);   // bei weitem Zoom etwas größer zeichnen
      const liv = ac.airline.liv;
      const x = this.sx(ac.x), y = this.sy(ac.y);
      const air = !ac.onGround;
      const shadowOff = (air ? Math.min(160, ac.altFt * 0.08) : 2.5) * k;
      const draw = (shadow) => {
        ctx.save();
        ctx.translate(x + (shadow ? shadowOff : 0), y + (shadow ? shadowOff * 0.6 : 0));
        ctx.rotate(U.rad(ac.hdg));
        ctx.scale(k, k);
        this.planeShape(ctx, T, L, S, liv, shadow, opts);
        ctx.restore();
      };
      ctx.globalAlpha = air ? 0.18 : 0.3; draw(true); ctx.globalAlpha = 1;
      draw(false);
      // Schlepper beim Pushback
      if (ac.state === 'PUSHING' || ac.state === 'TOW_WAIT') {
        const d = U.dirVec(ac.hdg);
        const tx = this.sx(ac.x + d.x * (ac.hl + 6)), ty = this.sy(ac.y + d.y * (ac.hl + 6));
        ctx.save(); ctx.translate(tx, ty); ctx.rotate(U.rad(ac.hdg)); ctx.fillStyle = '#e8b62c';
        ctx.fillRect(-2.2 * k, -4 * k, 4.4 * k, 8 * k); ctx.restore();
      }
    }

    planeShape(ctx, T, L, S, liv, shadow, opts) {
      const w = U.clamp(L * 0.1, 2.6, 6.6);
      const sweep = T.prop ? 0.03 : 0.5;
      const yLE = -L * (T.prop ? 0.08 : 0.06), cr = L * (T.prop ? 0.11 : 0.2), ct = L * (T.prop ? 0.08 : 0.06);
      const dy = (S / 2 - w / 2) * sweep;
      const col = (c) => shadow ? '#0d150d' : c;
      // Tragflächen
      ctx.fillStyle = col('#c4c9cf');
      ctx.beginPath();
      ctx.moveTo(w / 2, yLE); ctx.lineTo(S / 2, yLE + dy); ctx.lineTo(S / 2, yLE + dy + ct); ctx.lineTo(w / 2, yLE + cr);
      ctx.lineTo(-w / 2, yLE + cr); ctx.lineTo(-S / 2, yLE + dy + ct); ctx.lineTo(-S / 2, yLE + dy); ctx.lineTo(-w / 2, yLE);
      ctx.closePath(); ctx.fill();
      if (!shadow) {
        ctx.strokeStyle = 'rgba(80,90,100,0.35)'; ctx.lineWidth = 0.5; ctx.stroke();
        ctx.fillStyle = liv.accent; ctx.fillRect(S / 2 - 1.2, yLE + dy, 1.2, ct); ctx.fillRect(-S / 2, yLE + dy, 1.2, ct);
      }
      // Höhenleitwerk
      const hs = S * 0.34 / 2, yH = L * 0.36, ch = L * 0.1;
      ctx.fillStyle = col('#c4c9cf');
      ctx.beginPath(); ctx.moveTo(w * 0.3, yH); ctx.lineTo(hs, yH + hs * 0.55); ctx.lineTo(hs, yH + hs * 0.55 + ch * 0.45);
      ctx.lineTo(0, yH + ch); ctx.lineTo(-hs, yH + hs * 0.55 + ch * 0.45); ctx.lineTo(-hs, yH + hs * 0.55); ctx.lineTo(-w * 0.3, yH); ctx.closePath(); ctx.fill();
      // Triebwerke
      if (!T.rearEng) {
        const fr = T.eng === 4 ? [0.35, 0.66] : [T.prop ? 0.28 : 0.34];
        for (const f of fr) for (const sg of [-1, 1]) {
          const ex = sg * (w / 2 + (S / 2 - w / 2) * f), ey = yLE + dy * f;
          const ew = L * (T.prop ? 0.045 : 0.06), el = L * (T.prop ? 0.17 : 0.13);
          ctx.fillStyle = col(liv.eng);
          this.rr(ctx, ex - ew / 2, ey - el * 0.55, ew, el, ew / 2); ctx.fill();
          if (T.prop && !shadow) { ctx.fillStyle = 'rgba(40,40,40,0.18)'; ctx.beginPath(); ctx.ellipse(ex, ey - el * 0.55, S * 0.075, 0.6, 0, 0, Math.PI * 2); ctx.fill(); }
        }
      } else {
        for (const sg of [-1, 1]) { ctx.fillStyle = col(liv.eng); this.rr(ctx, sg * (w / 2 + 1.1) - 0.9, L * 0.2, 1.8, L * 0.12, 0.9); ctx.fill(); }
      }
      // Rumpf
      ctx.fillStyle = col(liv.fus);
      ctx.beginPath();
      ctx.moveTo(0, -L / 2);
      ctx.bezierCurveTo(w * 0.55, -L / 2 + 0.3, w / 2, -L / 2 + w * 1.1, w / 2, -L / 2 + w * 1.6);
      ctx.lineTo(w / 2, L * 0.28);
      ctx.quadraticCurveTo(w * 0.42, L * 0.46, 0.25, L / 2);
      ctx.lineTo(-0.25, L / 2);
      ctx.quadraticCurveTo(-w * 0.42, L * 0.46, -w / 2, L * 0.28);
      ctx.lineTo(-w / 2, -L / 2 + w * 1.6);
      ctx.bezierCurveTo(-w / 2, -L / 2 + w * 1.1, -w * 0.55, -L / 2 + 0.3, 0, -L / 2);
      ctx.fill();
      if (shadow) return;
      ctx.strokeStyle = 'rgba(60,70,80,0.35)'; ctx.lineWidth = 0.4; ctx.stroke();
      // Cockpitfenster
      ctx.fillStyle = '#2b3946'; ctx.beginPath(); ctx.ellipse(0, -L / 2 + w * 0.9, w * 0.32, w * 0.18, 0, 0, Math.PI * 2); ctx.fill();
      // Seitenleitwerk (von oben: schmaler Streifen) in Airline-Farbe
      ctx.fillStyle = liv.tail; this.rr(ctx, -w * 0.2, L * 0.27, w * 0.4, L * 0.23, w * 0.2); ctx.fill();
      ctx.fillStyle = liv.tail; ctx.globalAlpha = 0.85; ctx.fillRect(-w * 0.12, -L * 0.1, w * 0.24, L * 0.36); ctx.globalAlpha = 1;
      if (opts && opts.sel) {
        ctx.strokeStyle = '#ffd25c'; ctx.lineWidth = 1.6 / Math.max(this.cam.scale, 0.42);
        ctx.beginPath(); ctx.arc(0, 0, Math.max(L, S) * 0.62, 0, Math.PI * 2); ctx.stroke();
      }
    }

    rr(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
    }

    navLights(ctx, ac, t) {
      const k = Math.max(this.cam.scale, 0.3);
      const d = U.dirVec(ac.hdg), r = { x: d.y, y: -d.x };
      const p = (fx, rx) => [this.sx(ac.x + d.x * fx + r.x * rx), this.sy(ac.y + d.y * fx + r.y * rx)];
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const glow = (q, c, rad) => { const g = ctx.createRadialGradient(q[0], q[1], 0, q[0], q[1], rad); g.addColorStop(0, c); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(q[0] - rad, q[1] - rad, rad * 2, rad * 2); };
      glow(p(ac.T.len * 0.02, ac.hw), 'rgba(80,255,120,0.9)', 5 * k + 2);
      glow(p(ac.T.len * 0.02, -ac.hw), 'rgba(255,60,60,0.9)', 5 * k + 2);
      if (ac.moving || !ac.onGround) {
        if (Math.floor(t * 1.3) % 2 === 0) glow(p(0, 0), 'rgba(255,40,40,0.8)', 7 * k + 2);
        // Landescheinwerfer / Taxilicht
        const q = p(ac.hl + 25, 0), q0 = p(ac.hl, 0);
        const g = ctx.createRadialGradient(q[0], q[1], 0, q[0], q[1], 30 * k);
        g.addColorStop(0, 'rgba(255,250,220,0.35)'); g.addColorStop(1, 'rgba(255,250,220,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(q[0], q[1], 30 * k, 0, Math.PI * 2); ctx.fill(); void q0;
      }
      ctx.restore();
    }

    // ---------- Gesamtbild ----------
    render(sim, ui) {
      const ctx = this.ctx;
      const dark = sim.weather.darkness(sim.clock);
      const darkQ = Math.round(dark * 20) / 20;
      this.flowDir = sim.weather.opDir;
      const key = [this.w, this.h, this.cam.x.toFixed(1), this.cam.y.toFixed(1), this.cam.scale.toFixed(4), darkQ, this.showFlows, this.flowDir, this.dpr].join('|');
      if (key !== this.bgKey) {
        this.bg.width = this.cv.width; this.bg.height = this.cv.height;
        const b = this.bg.getContext('2d');
        b.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        this.drawStatic(b, darkQ);
        if (darkQ > 0) {
          b.fillStyle = `rgba(8,16,38,${0.66 * darkQ})`; b.fillRect(0, 0, this.w, this.h);
          this.drawLights(b, darkQ);
        }
        this.bgKey = key;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.bg, 0, 0);
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

      // Route des gewählten Flugzeugs / Vorschau
      const sel = ui.selected ? sim.byId[ui.selected] : null;
      if (sel && sel.path && sel.mode === 'path' && sel.onGround) this.drawPath(ctx, sel.path, sel.s, 'rgba(255,210,92,0.9)', [8, 6]);
      if (this.preview && this.preview.pts) this.drawPts(ctx, this.preview.pts, this.preview.ok ? 'rgba(90,210,235,0.95)' : 'rgba(240,90,80,0.9)');
      if (sel && sel.holdShort && sel.path) {
        const at = AP.pathAt(sel.path, sel.holdShort.s + sel.hl);
        ctx.fillStyle = '#ff5a4a'; ctx.beginPath(); ctx.arc(this.sx(at.x), this.sy(at.y), 4, 0, Math.PI * 2); ctx.fill();
      }

      // Fahrzeuge
      for (const v of sim.vehicles) {
        const k = Math.max(this.cam.scale, 0.3);
        ctx.save(); ctx.translate(this.sx(v.x), this.sy(v.y)); ctx.rotate(U.rad(v.hdg || 0));
        ctx.fillStyle = '#d62f2f'; ctx.fillRect(-2.5 * k, -5 * k, 5 * k, 10 * k);
        if (Math.floor(sim.t * 3) % 2) { ctx.fillStyle = '#5ab4ff'; ctx.fillRect(-2.5 * k, -5 * k, 5 * k, 2 * k); }
        ctx.restore();
      }

      // Flugzeuge: erst Boden, dann Luft
      const vis = sim.list.filter(a => a.visible && a.state !== 'GONE');
      vis.sort((a, b) => (a.onGround === b.onGround ? 0 : a.onGround ? -1 : 1));
      for (const ac of vis) this.drawAircraft(ctx, ac, { sel: ac.cs === ui.selected });
      if (dark > 0.25) for (const ac of vis) this.navLights(ctx, ac, sim.t);

      // Nebel
      if (sim.weather.vis < 5000) {
        const a = U.clamp(0.62 - sim.weather.vis / 2000, 0.05, 0.55);
        ctx.fillStyle = dark > 0.5 ? `rgba(120,130,150,${a * 0.7})` : `rgba(225,228,232,${a})`;
        ctx.fillRect(0, 0, this.w, this.h);
      }

      // Kollision
      if (sim.collision) {
        const c = sim.collision;
        ctx.strokeStyle = '#ff3b30'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(this.sx(c.x), this.sy(c.y), 30 + 6 * Math.sin(performance.now() / 150), 0, Math.PI * 2); ctx.stroke();
      }

      // Datenblöcke
      for (const ac of vis) this.drawLabel(ctx, sim, ac, ui);
    }

    drawPath(ctx, path, fromS, color, dash) {
      ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 2.2; ctx.setLineDash(dash || []);
      ctx.beginPath();
      let started = false;
      for (const p of path.pts) {
        if (p.s < fromS) continue;
        if (!started) { const a = AP.pathAt(path, fromS); ctx.moveTo(this.sx(a.x), this.sy(a.y)); started = true; }
        ctx.lineTo(this.sx(p.x), this.sy(p.y));
      }
      ctx.stroke(); ctx.restore();
    }
    drawPts(ctx, pts, color) {
      ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.setLineDash([10, 6]); ctx.lineCap = 'round';
      ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(this.sx(p.x), this.sy(p.y)) : ctx.moveTo(this.sx(p.x), this.sy(p.y)));
      ctx.stroke(); ctx.restore();
    }

    labelColor(sim, ac, ui) {
      const need = sim.needsAction(ac);
      if (need) return { fg: '#ffcf5a', bg: 'rgba(52,38,6,0.82)', need: true };
      if (ac.handoff && sim.isPlayer(ac.handoff.to)) return { fg: '#7fe0ee', bg: 'rgba(8,40,48,0.8)' };
      const mine = ac.freq && sim.isPlayer(ac.freq);
      if (mine) return { fg: '#f1f5f9', bg: 'rgba(16,26,38,0.78)' };
      return { fg: '#a9b6c4', bg: 'rgba(16,26,38,0.55)' };
    }

    drawLabel(ctx, sim, ac, ui) {
      const x = this.sx(ac.x), y = this.sy(ac.y);
      if (x < -60 || y < -40 || x > this.w + 60 || y > this.h + 40) return;
      const c = this.labelColor(sim, ac, ui);
      // bei weitem Zoom ruhende Flugzeuge ohne Handlungsbedarf nicht beschriften
      if (this.cam.scale < 0.5 && !c.need && ac.cs !== ui.selected && ['PRE', 'PARKED', 'GND_WAIT', 'CLEARED', 'CLR_RB'].includes(ac.state)) { ac._label = null; return; }
      const short = ATC.STATE_SHORT[ac.state] || '';
      let l2 = ac.type + ' ' + ac.T.wake;
      if (!ac.onGround) l2 += '  ' + String(Math.round(ac.altFt / 100)).padStart(3, '0');
      else if (ac.state === 'TAXI' && ac.taxiDest) l2 += '  ' + ac.taxiDest.name;
      else if (short) l2 += '  ' + short;
      if (ac.holdPos) l2 += ' HOLD';
      const sel = ac.cs === ui.selected;
      const ox = 16, oy = -22;
      const lx = x + ox, ly = y + oy;
      ctx.font = `600 13px 'Barlow Condensed', sans-serif`;
      const w1 = ctx.measureText(ac.cs).width;
      ctx.font = `500 12px 'Barlow Condensed', sans-serif`;
      const w2 = ctx.measureText(l2).width;
      const bw = Math.max(w1, w2) + 10, bh = 30;
      ctx.strokeStyle = c.fg; ctx.globalAlpha = 0.6; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x + 4, y - 4); ctx.lineTo(lx, ly + bh - 2); ctx.stroke(); ctx.globalAlpha = 1;
      ctx.fillStyle = c.bg; ctx.fillRect(lx, ly, bw, bh);
      if (sel || c.need) { ctx.strokeStyle = c.fg; ctx.lineWidth = sel ? 1.5 : 1; ctx.strokeRect(lx + 0.5, ly + 0.5, bw - 1, bh - 1); }
      ctx.fillStyle = c.fg; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.font = `600 13px 'Barlow Condensed', sans-serif`; ctx.fillText(ac.cs, lx + 5, ly + 2);
      ctx.font = `500 12px 'Barlow Condensed', sans-serif`; ctx.fillText(l2, lx + 5, ly + 16);
      ac._label = { x: lx, y: ly, w: bw, h: bh };
    }

    hitTest(sim, px, py) {
      let best = null, bd = 1e9;
      for (const ac of sim.list) {
        if (!ac.visible) continue;
        const l = ac._label;
        if (l && px >= l.x && px <= l.x + l.w && py >= l.y && py <= l.y + l.h) return ac.cs;
        const d = Math.hypot(this.sx(ac.x) - px, this.sy(ac.y) - py);
        const r = Math.max(12, Math.max(ac.T.len, ac.T.span) * 0.5 * Math.max(this.cam.scale, 0.42));
        if (d < r && d < bd) { bd = d; best = ac.cs; }
      }
      return best;
    }
  }

  ATC.Renderer = Renderer;
})(ATC);
