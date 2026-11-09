// Hilfsfunktionen: Mathe, Zufall, Zeitformat und Funk-Phraseologie.
// Weltkoordinaten: x = Osten (Meter), y = Norden (Meter). Kurs 0° = Norden, 90° = Osten.
var ATC = (typeof window !== 'undefined' ? window : globalThis).ATC = (typeof window !== 'undefined' ? window : globalThis).ATC || {};

(function (ATC) {
  const U = {};

  U.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
  U.rad = (d) => d * Math.PI / 180;
  U.deg = (r) => r * 180 / Math.PI;
  U.hdgOf = (dx, dy) => ((U.deg(Math.atan2(dx, dy)) % 360) + 360) % 360;
  U.angDiff = (a, b) => ((((b - a) % 360) + 540) % 360) - 180; // -180..180
  U.dirVec = (h) => ({ x: Math.sin(U.rad(h)), y: Math.cos(U.rad(h)) });
  U.ktToMs = (kt) => kt * 0.514444;
  U.msToKt = (ms) => ms / 0.514444;

  // Deterministischer Zufallsgenerator (mulberry32), damit Szenarien reproduzierbar sind.
  U.rng = function (seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  U.pick = (r, arr) => arr[Math.floor(r() * arr.length)];
  U.range = (r, a, b) => a + (b - a) * r();
  U.weighted = (r, items, wf) => {
    const tot = items.reduce((s, i) => s + wf(i), 0);
    let x = r() * tot;
    for (const i of items) { x -= wf(i); if (x <= 0) return i; }
    return items[items.length - 1];
  };

  // Zeit: Sekunden seit Mitternacht -> "HH:MM" / "HH:MM:SS"
  U.hhmm = (s) => {
    s = ((Math.floor(s) % 86400) + 86400) % 86400;
    return String(Math.floor(s / 3600)).padStart(2, '0') + ':' + String(Math.floor(s / 60) % 60).padStart(2, '0');
  };
  U.hhmmss = (s) => U.hhmm(s) + ':' + String(Math.floor(s) % 60).padStart(2, '0');
  U.mmss = (s) => {
    s = Math.max(0, Math.floor(s));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  };

  // ---------- Phraseologie ----------
  // Jede Funkphrase wird aus Teilen gebaut, die einen Anzeigetext (t) und einen Sprechtext (s) haben.
  const DIG = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'niner'];
  const PHON = {
    A: 'Alpha', B: 'Bravo', C: 'Charlie', D: 'Delta', E: 'Echo', F: 'Foxtrot', G: 'Golf', H: 'Hotel',
    I: 'India', J: 'Juliett', K: 'Kilo', L: 'Lima', M: 'Mike', N: 'November', O: 'Oscar', P: 'Papa',
    Q: 'Quebec', R: 'Romeo', S: 'Sierra', T: 'Tango', U: 'Uniform', V: 'Victor', W: 'Whiskey',
    X: 'X-ray', Y: 'Yankee', Z: 'Zulu'
  };
  U.PHON = PHON;
  U.sayDigits = (str) => String(str).split('').map(c => {
    if (c >= '0' && c <= '9') return DIG[+c];
    if (c === '.') return 'decimal';
    if (PHON[c]) return PHON[c];
    return c;
  }).join(' ');

  const P = {};
  P.cs = (ac) => ({ t: ac.telephony + ' ' + ac.flightNo, s: ac.telephonySpoken + ' ' + U.sayDigits(ac.flightNo) });
  P.rwy = (r) => {
    const num = r.slice(0, 2), side = r.slice(2);
    const sideS = side === 'L' ? ' left' : side === 'R' ? ' right' : side === 'C' ? ' center' : '';
    return { t: 'runway ' + r, s: 'runway ' + U.sayDigits(num) + sideS };
  };
  P.twy = (n) => ({ t: n, s: U.sayDigits(n) });
  P.twyList = (arr) => ({ t: arr.join(', '), s: arr.map(n => U.sayDigits(n)).join(', ') });
  P.sq = (c) => ({ t: 'squawk ' + c, s: 'squawk ' + U.sayDigits(c) });
  P.alt = (ft) => {
    const th = Math.floor(ft / 1000), hu = Math.floor((ft % 1000) / 100);
    let s = '';
    if (th) s += (th >= 10 ? U.sayDigits(String(th)) : DIG[th]).replace('niner', 'nine') + ' thousand';
    if (hu) s += ' ' + DIG[hu].replace('niner', 'nine') + ' hundred';
    return { t: ft + ' ft', s: s.trim() + ' feet' };
  };
  P.freq = (f) => ({ t: f, s: U.sayDigits(f) });
  P.stand = (st) => ({ t: 'stand ' + st, s: 'stand ' + U.sayDigits(st) });
  P.sid = (sid) => {
    const m = sid.match(/^([A-Z]+)\s?(\d)([A-Z])$/);
    if (!m) return { t: sid, s: sid };
    return { t: sid, s: m[1].toLowerCase() + ' ' + DIG[+m[2]] + ' ' + PHON[m[3]] };
  };
  P.letter = (l) => ({ t: l, s: PHON[l] || l });
  P.hdgWord = (h) => ['north', 'east', 'south', 'west'][Math.round(((h % 360) + 360) % 360 / 90) % 4];
  U.P = P;

  // Fügt Teile (Strings oder {t,s}) zu {text, speech} zusammen.
  U.phrase = function (...parts) {
    let t = '', s = '';
    for (const p of parts) {
      if (p == null) continue;
      if (typeof p === 'string') { t += p; s += p; } else { t += p.t; s += p.s; }
    }
    return { text: t.replace(/\s+/g, ' ').trim(), speech: s.replace(/\s+/g, ' ').trim() };
  };

  // Orientierte Rechtecke (Flugzeug-Umriss) auf Überlappung prüfen (Separating Axis Test).
  U.obb = (x, y, hdg, hl, hw) => {
    const f = U.dirVec(hdg);
    return { x, y, fx: f.x, fy: f.y, rx: f.y, ry: -f.x, hl, hw };
  };
  U.obbOverlap = (a, b, margin = 0) => {
    const axes = [[a.fx, a.fy], [a.rx, a.ry], [b.fx, b.fy], [b.rx, b.ry]];
    const dx = b.x - a.x, dy = b.y - a.y;
    for (const [ax, ay] of axes) {
      const ra = (a.hl + margin) * Math.abs(a.fx * ax + a.fy * ay) + (a.hw + margin) * Math.abs(a.rx * ax + a.ry * ay);
      const rb = b.hl * Math.abs(b.fx * ax + b.fy * ay) + b.hw * Math.abs(b.rx * ax + b.ry * ay);
      if (Math.abs(dx * ax + dy * ay) > ra + rb) return false;
    }
    return true;
  };

  // Flugzeug-Umriss als drei Rechtecke (Rumpf, Tragfläche, Höhenleitwerk) – viel genauer als ein einziges Rechteck.
  U.acShape = (x, y, hdg, len, span) => {
    const f = U.dirVec(hdg);
    const at = (off, hl, hw) => U.obb(x + f.x * off, y + f.y * off, hdg, hl, hw);
    return [
      at(0, len / 2, Math.max(2.2, len * 0.055)),
      at(len * 0.02, len * 0.14, span / 2),
      at(-len * 0.4, len * 0.07, span * 0.18)
    ];
  };
  U.shapeOverlap = (A, B, margin = 0) => {
    for (const a of A) for (const b of B) if (U.obbOverlap(a, b, margin)) return true;
    return false;
  };

  ATC.U = U;
})(ATC);
