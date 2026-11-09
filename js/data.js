// Stammdaten: Flugzeugtypen mit Leistungsdaten, fiktive Airlines, Ziele, SIDs, Frequenzen.
(function (ATC) {
  const D = {};

  // len/span in Metern. wake: L/M/H/J (Super). tora: benötigte Startbahnlänge (m).
  // roll: Ausrollstrecke nach dem Aufsetzen bis Rollgeschwindigkeit (m). vr: Abhebegeschwindigkeit (kt).
  // acc: Beschleunigung im Startlauf (m/s²). code: ICAO-Flugplatz-Referenzcode (Spannweite).
  D.TYPES = {
    A20N: { name: 'A320neo', wake: 'M', len: 37.6, span: 35.8, eng: 2, prop: false, tora: 2300, roll: 1350, vr: 140, acc: 2.1, code: 'C', vapp: 135 },
    A320: { name: 'A320', wake: 'M', len: 37.6, span: 35.8, eng: 2, prop: false, tora: 2400, roll: 1400, vr: 142, acc: 2.0, code: 'C', vapp: 136 },
    A321: { name: 'A321', wake: 'M', len: 44.5, span: 35.8, eng: 2, prop: false, tora: 2800, roll: 1550, vr: 148, acc: 1.9, code: 'C', vapp: 140 },
    B738: { name: 'B737-800', wake: 'M', len: 39.5, span: 35.8, eng: 2, prop: false, tora: 2500, roll: 1450, vr: 145, acc: 2.0, code: 'C', vapp: 142 },
    B38M: { name: 'B737 MAX 8', wake: 'M', len: 39.5, span: 35.9, eng: 2, prop: false, tora: 2400, roll: 1400, vr: 144, acc: 2.1, code: 'C', vapp: 140 },
    E190: { name: 'E190', wake: 'M', len: 36.2, span: 28.7, eng: 2, prop: false, tora: 2000, roll: 1200, vr: 135, acc: 2.2, code: 'C', vapp: 128 },
    CRJ9: { name: 'CRJ900', wake: 'M', len: 36.2, span: 24.9, eng: 2, prop: false, tora: 2100, roll: 1250, vr: 138, acc: 2.1, code: 'C', vapp: 130, rearEng: true },
    AT76: { name: 'ATR 72-600', wake: 'M', len: 27.2, span: 27.1, eng: 2, prop: true, tora: 1400, roll: 900, vr: 110, acc: 2.0, code: 'C', vapp: 110, highWing: true },
    DH8D: { name: 'Dash 8-400', wake: 'M', len: 32.8, span: 28.4, eng: 2, prop: true, tora: 1500, roll: 950, vr: 118, acc: 2.2, code: 'C', vapp: 120, highWing: true },
    A333: { name: 'A330-300', wake: 'H', len: 63.7, span: 60.3, eng: 2, prop: false, tora: 3300, roll: 1900, vr: 155, acc: 1.6, code: 'E', vapp: 140 },
    A359: { name: 'A350-900', wake: 'H', len: 66.8, span: 64.8, eng: 2, prop: false, tora: 3300, roll: 1950, vr: 155, acc: 1.7, code: 'E', vapp: 142 },
    B789: { name: 'B787-9', wake: 'H', len: 62.8, span: 60.1, eng: 2, prop: false, tora: 3200, roll: 1900, vr: 154, acc: 1.7, code: 'E', vapp: 145 },
    B77W: { name: 'B777-300ER', wake: 'H', len: 73.9, span: 64.8, eng: 2, prop: false, tora: 3600, roll: 2050, vr: 165, acc: 1.5, code: 'E', vapp: 149 },
    B77F: { name: 'B777F', wake: 'H', len: 63.7, span: 64.8, eng: 2, prop: false, tora: 3600, roll: 2050, vr: 165, acc: 1.45, code: 'E', vapp: 148 },
    B744: { name: 'B747-400F', wake: 'H', len: 70.7, span: 64.4, eng: 4, prop: false, tora: 3700, roll: 2100, vr: 165, acc: 1.4, code: 'E', vapp: 150 },
    A306: { name: 'A300-600F', wake: 'H', len: 54.1, span: 44.8, eng: 2, prop: false, tora: 3000, roll: 1800, vr: 150, acc: 1.6, code: 'D', vapp: 138 },
    A388: { name: 'A380-800', wake: 'J', len: 72.7, span: 79.8, eng: 4, prop: false, tora: 3900, roll: 2200, vr: 155, acc: 1.4, code: 'F', vapp: 140 }
  };
  D.CODE_SPAN = { C: 36, D: 52, E: 65, F: 80 };

  // Fiktive Airlines. tel = Rufzeichen im Funk.
  D.AIRLINES = [
    { icao: 'LNX', tel: 'LINDEN', name: 'Lindenair', w: 9, fleet: ['A20N', 'A320', 'A321', 'A321', 'E190'], long: ['A359', 'A333'], longShare: 0.18,
      liv: { fus: '#ffffff', tail: '#1f4fa3', eng: '#1f4fa3', accent: '#e8b630' } },
    { icao: 'PLW', tel: 'POLARIS', name: 'Polaris Airways', w: 4, fleet: ['B738', 'B38M'], long: ['B789'], longShare: 0.15,
      liv: { fus: '#f4f6f8', tail: '#0f7f8c', eng: '#dfe3e6', accent: '#0f7f8c' } },
    { icao: 'SVJ', tel: 'SUNVALE', name: 'Sunvale', w: 4, fleet: ['A321', 'B738', 'A320'], long: [], longShare: 0,
      liv: { fus: '#ffffff', tail: '#f28c28', eng: '#f28c28', accent: '#ffd23f' }, leisure: true },
    { icao: 'MRX', tel: 'MERIDIAN', name: 'Meridian', w: 3, fleet: ['A320', 'A20N'], long: ['A333'], longShare: 0.2,
      liv: { fus: '#fbfbfb', tail: '#7a1f3d', eng: '#7a1f3d', accent: '#c9a227' } },
    { icao: 'CRV', tel: 'CORVO', name: 'Corvo Air', w: 3, fleet: ['E190', 'A320'], long: [], longShare: 0,
      liv: { fus: '#ffffff', tail: '#2e7d32', eng: '#ffffff', accent: '#c62828' } },
    { icao: 'ALB', tel: 'ALBION', name: 'Albion', w: 2, fleet: ['A320', 'A321'], long: ['B77W'], longShare: 0.25,
      liv: { fus: '#ffffff', tail: '#1b2a4a', eng: '#9aa4b2', accent: '#d32f2f' } },
    { icao: 'IBW', tel: 'IBERWING', name: 'Iberwing', w: 2, fleet: ['A321', 'A20N'], long: [], longShare: 0,
      liv: { fus: '#ffffff', tail: '#c62828', eng: '#c62828', accent: '#ffcc00' } },
    { icao: 'TDX', tel: 'TUNDRA', name: 'Tundra Regional', w: 3, fleet: ['CRJ9', 'AT76', 'DH8D'], long: [], longShare: 0,
      liv: { fus: '#f2f2f2', tail: '#455a64', eng: '#455a64', accent: '#4fc3f7' }, regional: true },
    { icao: 'DFL', tel: 'DESERT FALCON', name: 'Desert Falcon', w: 2, fleet: [], long: ['A388', 'B77W', 'B789'], longShare: 1,
      liv: { fus: '#f7f3ea', tail: '#b08d57', eng: '#6d5a3a', accent: '#3e2f1c' } },
    { icao: 'KCG', tel: 'KESTREL', name: 'Kestrel Cargo', w: 2, fleet: ['A306'], long: ['B77F', 'B744'], longShare: 0.6, cargo: true,
      liv: { fus: '#e9e9e9', tail: '#5d4037', eng: '#5d4037', accent: '#ff7043' } }
  ];

  // Ziele mit grober Abflugrichtung (W/N/E/S) für die SID-Zuordnung.
  D.DEST = [
    { icao: 'EGLL', city: 'London', dir: 'W' }, { icao: 'LFPG', city: 'Paris', dir: 'W' },
    { icao: 'EHAM', city: 'Amsterdam', dir: 'N' }, { icao: 'EKCH', city: 'Copenhagen', dir: 'N' },
    { icao: 'ESSA', city: 'Stockholm', dir: 'N' }, { icao: 'EDDH', city: 'Hamburg', dir: 'N' },
    { icao: 'EDDB', city: 'Berlin', dir: 'N' }, { icao: 'EPWA', city: 'Warsaw', dir: 'E' },
    { icao: 'LKPR', city: 'Prague', dir: 'E' }, { icao: 'LOWW', city: 'Vienna', dir: 'E' },
    { icao: 'LHBP', city: 'Budapest', dir: 'E' }, { icao: 'LTFM', city: 'Istanbul', dir: 'E' },
    { icao: 'LGAV', city: 'Athens', dir: 'S' }, { icao: 'LIRF', city: 'Rome', dir: 'S' },
    { icao: 'LEPA', city: 'Palma', dir: 'S', leisure: true }, { icao: 'GCLP', city: 'Gran Canaria', dir: 'S', leisure: true },
    { icao: 'LEMD', city: 'Madrid', dir: 'W' }, { icao: 'LPPT', city: 'Lisbon', dir: 'W' },
    { icao: 'LSZH', city: 'Zurich', dir: 'S' }, { icao: 'LIMC', city: 'Milan', dir: 'S' },
    { icao: 'LFMN', city: 'Nice', dir: 'S', leisure: true }, { icao: 'LGIR', city: 'Heraklion', dir: 'S', leisure: true },
    { icao: 'LTAI', city: 'Antalya', dir: 'E', leisure: true }
  ];
  D.DEST_LONG = [
    { icao: 'KJFK', city: 'New York', dir: 'W' }, { icao: 'KORD', city: 'Chicago', dir: 'W' },
    { icao: 'CYYZ', city: 'Toronto', dir: 'W' }, { icao: 'OMDB', city: 'Dubai', dir: 'E' },
    { icao: 'OTHH', city: 'Doha', dir: 'E' }, { icao: 'VTBS', city: 'Bangkok', dir: 'E' },
    { icao: 'WSSS', city: 'Singapore', dir: 'E' }
  ];

  // SIDs: Fix je Richtung; Buchstabe je Betriebsrichtung (W = Betriebsrichtung 27, E = 09).
  D.SID_FIX = { W: 'ROKAT', N: 'NOLBI', E: 'ESMAR', S: 'SOGPO' };
  D.SID_ALT = { W: 5000, N: 6000, E: 5000, S: 7000 };
  D.sidFor = (dir, opDir) => D.SID_FIX[dir] + (opDir === 27 ? '1W' : '2E');
  D.sidMatches = (sid, opDir) => !!sid && sid.endsWith(opDir === 27 ? 'W' : 'E');

  D.FREQ = { DEL: '121.905', GND: '121.775', TWR: '118.705', APP: '120.805', DEP: '125.355', ATIS: '123.125' };
  D.STATION = { DEL: 'Lindenau Delivery', GND: 'Lindenau Ground', TWR: 'Lindenau Tower', APP: 'Lindenau Approach', DEP: 'Lindenau Departure' };
  D.ROLE_NAME = { DEL: 'Delivery', GND: 'Ground', TWR: 'Tower', APP: 'Approach', DEP: 'Departure' };

  // Wirbelschleppen-Staffelung für Starts (Sekunden): [vorausfliegend][folgend]
  D.WAKE_DEP = {
    J: { J: 120, H: 120, M: 180, L: 180 },
    H: { J: 90, H: 90, M: 120, L: 120 },
    M: { J: 60, H: 60, M: 60, L: 90 },
    L: { J: 60, H: 60, M: 60, L: 50 }
  };
  // Anflugstaffelung in Sekunden über der Schwelle (entspricht etwa 3-8 NM)
  D.WAKE_ARR = {
    J: { J: 120, H: 150, M: 190, L: 220 },
    H: { J: 90, H: 120, M: 150, L: 180 },
    M: { J: 90, H: 90, M: 90, L: 120 },
    L: { J: 90, H: 90, M: 90, L: 90 }
  };

  ATC.D = D;
})(ATC);
