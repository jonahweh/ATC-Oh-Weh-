// Befehlszeile: Text wie "LNX427 TX N8 VIA G Z B" in Simulationsbefehle übersetzen.
(function (ATC) {
  const C = {};

  // Befehlsdefinitionen: Schlüsselwort -> {pos, args, help, run}
  C.DEFS = {
    CLR: { pos: 'DEL', help: 'Streckenfreigabe, optional SID/Höhe/Squawk', ex: 'CLR  ·  CLR ROKAT1W 5000 4721' },
    RBC: { pos: 'DEL', help: 'Readback korrekt', ex: 'RBC' },
    GND: { pos: 'DEL', help: 'An Ground übergeben (contact Ground)', ex: 'GND' },
    PB: { pos: 'GND', help: 'Pushback & Startup, Blickrichtung N/E/S/W', ex: 'PB E' },
    PBH: { pos: 'GND', help: 'Pushback verzögern (Minuten)', ex: 'PBH 3' },
    TX: { pos: 'GND', help: 'Rollen zu Holding Point/Stand, optional Route', ex: 'TX N8 VIA G Z B  ·  TX 104' },
    HOLD: { pos: 'GND', help: 'Sofort anhalten (hold position)', ex: 'HOLD' },
    CONT: { pos: 'GND', help: 'Weiterrollen (continue taxi)', ex: 'CONT' },
    HS: { pos: 'GND', help: 'Vor Rollweg halten (hold short)', ex: 'HS B' },
    GW: { pos: 'GND', help: 'Vorfahrt gewähren (give way)', ex: 'GW PLW512' },
    FL: { pos: 'GND', help: 'Folgen (follow)', ex: 'FL PLW512' },
    STAND: { pos: 'GND', help: 'Stand zuweisen/ändern', ex: 'STAND 214' },
    TWR: { pos: 'GND', help: 'An Tower übergeben (contact Tower)', ex: 'TWR' },
    ACC: { pos: null, help: 'Übergabe annehmen', ex: 'ACC' }
  };
  const KEYS = new Set(Object.keys(C.DEFS).concat(['VIA']));

  C.parse = function (sim, text, selected) {
    const toks = String(text).toUpperCase().replace(/[,;]/g, ' ').split(/\s+/).filter(Boolean);
    if (!toks.length) return { error: 'Leere Eingabe.' };
    let ac = null;
    if (!KEYS.has(toks[0])) {
      ac = sim.findAc(toks[0]);
      if (!ac) return { error: `Unbekanntes Rufzeichen „${toks[0]}“.` };
      toks.shift();
    } else ac = selected || null;
    if (!ac) return { error: 'Kein Flugzeug gewählt – Rufzeichen voranstellen oder in der Liste anklicken.' };
    const cmds = [];
    let cur = null;
    for (const t of toks) {
      if (C.DEFS[t]) { cur = { k: t, args: [] }; cmds.push(cur); }
      else if (!cur) return { error: `„${t}“ ist kein Befehl. Hilfe: F1` };
      else cur.args.push(t);
    }
    if (!cmds.length) return { error: 'Kein Befehl angegeben.' };
    return { ac, cmds };
  };

  C.exec = function (sim, ac, k, args) {
    const def = C.DEFS[k];
    if (def.pos && !sim.isPlayer(def.pos)) return { ok: false, msg: `Du bist nicht ${ATC.D.ROLE_NAME[def.pos]}.` };
    switch (k) {
      case 'CLR': {
        const p = {};
        for (let i = 0; i < args.length; i++) {
          const a = args[i];
          if (a === 'SID') p.sid = args[++i];
          else if (a === 'ALT') p.alt = +args[++i];
          else if (a === 'SQ' || a === 'SQUAWK') p.sq = args[++i];
          else if (/^[A-Z]{5}\d[A-Z]$/.test(a)) p.sid = a;
          else if (/^\d{4,5}$/.test(a) && +a % 1000 === 0 && +a >= 3000) p.alt = +a;
          else if (/^[0-7]{4}$/.test(a)) p.sq = a;
          else return { ok: false, msg: `CLR: „${a}“ nicht erkannt.` };
        }
        return sim.cmdClearance(ac, p);
      }
      case 'RBC': return sim.cmdReadbackCorrect(ac);
      case 'GND': return sim.cmdContactGround(ac);
      case 'PB': return sim.cmdPushback(ac, args[0]);
      case 'PBH': return sim.cmdPushHold(ac, +(args[0] || 2));
      case 'TX': {
        const dest = args[0];
        const rest = args.slice(1).filter(a => a !== 'VIA');
        return sim.cmdTaxi(ac, dest, rest);
      }
      case 'HOLD': return sim.cmdHold(ac);
      case 'CONT': return sim.cmdContinue(ac);
      case 'HS': return args[0] ? sim.cmdHoldShort(ac, args[0]) : { ok: false, msg: 'HS braucht einen Rollweg.' };
      case 'GW': return args[0] ? sim.cmdGiveWay(ac, args[0], false) : { ok: false, msg: 'GW braucht ein Rufzeichen.' };
      case 'FL': return args[0] ? sim.cmdGiveWay(ac, args[0], true) : { ok: false, msg: 'FL braucht ein Rufzeichen.' };
      case 'STAND': return args[0] ? sim.cmdStand(ac, args[0]) : { ok: false, msg: 'STAND braucht eine Standnummer.' };
      case 'TWR': return sim.cmdContactTower(ac);
      case 'ACC': {
        if (!ac.handoff) return { ok: false, msg: 'Keine offene Übergabe.' };
        if (!sim.isPlayer(ac.handoff.to)) return { ok: false, msg: 'Diese Übergabe ist nicht für dich.' };
        return sim.acceptHandoff(ac, ac.handoff.to);
      }
    }
    return { ok: false, msg: 'Unbekannter Befehl.' };
  };

  C.run = function (sim, text, selected) {
    const p = C.parse(sim, text, selected);
    if (p.error) return { ok: false, msg: p.error };
    for (const c of p.cmds) {
      const r = C.exec(sim, p.ac, c.k, c.args);
      if (!r || !r.ok) return Object.assign({ ac: p.ac }, r || { ok: false, msg: 'Fehler' });
    }
    return { ok: true, ac: p.ac };
  };

  ATC.CMD = C;
})(ATC);
