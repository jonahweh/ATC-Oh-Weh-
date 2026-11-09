// Funkphrasen (englisch, ICAO-Phraseologie) und Sprachausgabe.
(function (ATC) {
  const U = ATC.U, P = U.P, D = ATC.D;
  const ph = U.phrase;
  const R = {};

  const st = (pos) => ({ t: D.STATION[pos], s: D.STATION[pos] });
  const rwyOf = (sim, hpName) => {
    const hp = ATC.AP.hps[hpName];
    return P.rwy(ATC.AP.rwyName(hp.rwy, sim.weather.opDir));
  };

  // ---------- Pilot ----------
  R.pilot = {
    clrRequest: (sim, ac, letter) => ph(st('DEL'), ', ', P.cs(ac), ', ', P.stand(ac.stand), ', information ', P.letter(letter),
      ', request IFR clearance to ', ac.dest.city, '.'),
    clrReadback: (ac, c, revised) => ph(revised ? 'Revised clearance, ' : '', 'cleared to ', ac.dest.city, ' via ', P.sid(c.sid), ' departure, initial climb ',
      P.alt(c.alt), ', ', P.sq(c.sq), ', ', P.cs(ac), '.'),
    freqReadback: (ac, pos) => ph(P.freq(D.FREQ[pos]), ', ', P.cs(ac), '.'),
    pushRequest: (ac) => ph(st('GND'), ', ', P.cs(ac), ', ', P.stand(ac.stand), ', request pushback and startup.'),
    pushReadback: (ac, facing) => ph('Pushback and startup approved, facing ', P.hdgWord(facing), ', ', P.cs(ac), '.'),
    pushHoldReadback: (ac, mins) => ph('Holding position, expect pushback in ', String(mins), ' minutes, ', P.cs(ac), '.'),
    readyTaxi: (ac) => ph(P.cs(ac), ', ready for taxi.'),
    taxiReadback: (sim, ac, dest, via) => dest.type === 'hp'
      ? ph('Taxi to holding point ', P.twy(dest.name), ' ', rwyOf(sim, dest.name), via.length ? ' via ' : '', via.length ? P.twyList(via) : '', ', ', P.cs(ac), '.')
      : ph('Taxi to ', P.stand(dest.name), via.length ? ' via ' : '', via.length ? P.twyList(via) : '', ', ', P.cs(ac), '.'),
    holdReadback: (ac) => ph('Holding position, ', P.cs(ac), '.'),
    contReadback: (ac) => ph('Continue taxi, ', P.cs(ac), '.'),
    holdShortReadback: (ac, t) => ph('Hold short of ', P.twy(t), ', ', P.cs(ac), '.'),
    giveWayReadback: (ac, o) => ph('Give way to ', P.cs(o), ', traffic in sight, ', P.cs(ac), '.'),
    followReadback: (ac, o) => ph('Follow ', P.cs(o), ', ', P.cs(ac), '.'),
    standReadback: (ac, s) => ph('New ', P.stand(s), ', ', P.cs(ac), '.'),
    atHp: (sim, ac) => ph(P.cs(ac), ', holding short ', rwyOf(sim, ac.taxiDest.name), ' at ', P.twy(ac.taxiDest.name), '.'),
    vacated: (sim, ac) => ph(st('GND'), ', ', P.cs(ac), ', vacated ', P.rwy(ATC.AP.rwyName(ac.rwy, sim.weather.opDir)), ' via ', P.twy(ac.exitName),
      ac.stand ? ', request taxi to ' : ', request stand assignment', ac.stand ? P.stand(ac.stand) : '', '.'),
    initialGnd: (ac) => ph(st('GND'), ', ', P.cs(ac), ', on frequency.'),
    sayAgain: (ac) => ph('Say again, ', P.cs(ac), '.'),
    unableRoute: (ac) => ph(P.cs(ac), ', unable to comply with that routing, request alternate taxi instructions.'),
    unableIntersection: (ac, hp) => ph('Unable intersection departure from ', P.twy(hp), ', we require full length, ', P.cs(ac), '.'),
    confirmHp: (sim, ac, hp) => ph(P.cs(ac), ', confirm holding point ', P.twy(hp), '? Runway in use is ', P.rwy(sim.weather.opDir === 27 ? '27' : '09'), '.'),
    standUnsuitable: (ac, s) => ph(P.cs(ac), ', unable ', P.stand(s), ', it is not suitable for our aircraft.'),
    standOccupied: (ac, s) => ph(P.cs(ac), ', ', P.stand(s), ' is occupied.'),
    needTow: (ac) => ph(P.cs(ac), ', unable to turn around here, we require a tug, expect about two minutes.'),
    missedTurn: (ac) => ph(P.cs(ac), ', sorry, we missed our turn, now holding position, request further instructions.'),
    notOnRoute: (ac, t) => ph(P.cs(ac), ', ', P.twy(t), ' is not on our route, confirm?'),
    secondCall: (msg) => ({ text: msg.text.replace(/\.$/, ', second call.'), speech: msg.speech.replace(/\.$/, ', second call.') }),
    stoppingTraffic: (ac) => ph(P.cs(ac), ', stopping, traffic ahead.'),
    blocked: (ac, o) => ph(P.cs(ac), ', we are nose to nose with ', P.cs(o), ', request instructions.'),
    medical: (ac) => ph('PAN PAN, PAN PAN, PAN PAN, ', P.cs(ac), ', medical emergency on board, request return to stand.'),
    brakes: (ac) => ph(P.cs(ac), ', we have to stop here, hot brakes, request fire services.'),
    engineFire: (ac) => ph('MAYDAY, MAYDAY, MAYDAY, ', P.cs(ac), ', engine fire warning, shutting down, request fire services.'),
    readyAgain: (ac) => ph(P.cs(ac), ', fire services cleared us, ready to taxi.'),
    wrongHp: (sim, ac) => ph(st('GND'), ', ', P.cs(ac), ', Tower is unable to give departure clearance from ', P.twy(ac.taxiDest.name), ', request instructions.'),
    wrongSid: (ac) => ph(st('GND'), ', ', P.cs(ac), ', Tower says our SID is not valid for the runway in use, request revised clearance.'),
    ack: (ac) => ph(P.cs(ac), '.')
  };

  // ---------- Lotse (Spieler oder KI) ----------
  R.atc = {
    clearance: (ac, c, revised) => ph(P.cs(ac), revised ? ', revised clearance, cleared to ' : ', cleared to ', ac.dest.city, ' via ', P.sid(c.sid), ' departure, climb initial ',
      P.alt(c.alt), ', ', P.sq(c.sq), '.'),
    rbc: (ac) => ph(P.cs(ac), ', readback correct.'),
    contact: (ac, pos) => ph(P.cs(ac), ', contact ', D.STATION[pos].replace('Lindenau ', ''), ' ', P.freq(D.FREQ[pos]), '.'),
    push: (ac, facing) => ph(P.cs(ac), ', pushback and startup approved, facing ', P.hdgWord(facing), '.'),
    pushHold: (ac, mins) => ph(P.cs(ac), ', hold position, expect pushback in ', String(mins), ' minutes.'),
    taxi: (sim, ac, dest, via) => dest.type === 'hp'
      ? ph(P.cs(ac), ', taxi to holding point ', P.twy(dest.name), ' ', rwyOf(sim, dest.name), via.length ? ' via ' : '', via.length ? P.twyList(via) : '', '.')
      : ph(P.cs(ac), ', taxi to ', P.stand(dest.name), via.length ? ' via ' : '', via.length ? P.twyList(via) : '', '.'),
    hold: (ac) => ph(P.cs(ac), ', hold position.'),
    cont: (ac) => ph(P.cs(ac), ', continue taxi.'),
    holdShort: (ac, t) => ph(P.cs(ac), ', hold short of ', P.twy(t), '.'),
    giveWay: (ac, o, rel) => ph(P.cs(ac), ', give way to ', P.cs(o), ', ', ATC.D.TYPES[o.type].name.replace(/-.*$/, ''), ' ', rel, '.'),
    follow: (ac, o) => ph(P.cs(ac), ', follow ', P.cs(o), '.'),
    stand: (ac, s) => ph(P.cs(ac), ', new ', P.stand(s), '.'),
    lineup: (sim, ac) => ph(P.cs(ac), ', ', rwyOf(sim, ac.taxiDest.name), ', line up and wait.'),
    takeoff: (sim, ac) => ph(P.cs(ac), ', wind ', sim.weather.windText().replace('°/', ' degrees ').replace('kt', ' knots'), ', ', rwyOf(sim, ac.taxiDest.name), ', cleared for takeoff.'),
    landing: (sim, ac) => ph(P.cs(ac), ', wind ', sim.weather.windText().replace('°/', ' degrees ').replace('kt', ' knots'), ', ', P.rwy(ATC.AP.rwyName(ac.rwy, sim.weather.opDir)), ', cleared to land.'),
    goAround: (ac) => ph(P.cs(ac), ', go around, I say again, go around, runway occupied.'),
    vacate: (ac) => ph(P.cs(ac), ', vacate via ', P.twy(ac.exitName), ', contact Ground ', P.freq(D.FREQ.GND), '.')
  };

  // ---------- Sprachausgabe (Web Speech API) ----------
  const TTS = R.tts = {
    enabled: false, voices: [], queue: 0,
    init() {
      if (typeof window === 'undefined' || !window.speechSynthesis) return;
      const load = () => { this.voices = speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang)); };
      load();
      speechSynthesis.onvoiceschanged = load;
    },
    speak(text, seed, isAtc) {
      if (!this.enabled || typeof window === 'undefined' || !window.speechSynthesis) return;
      if (speechSynthesis.pending && this.queue > 2) return; // nicht zu viel stauen
      const u = new SpeechSynthesisUtterance(text);
      const vs = this.voices;
      if (vs.length) u.voice = vs[(seed >>> 0) % vs.length];
      u.lang = u.voice ? u.voice.lang : 'en-US';
      u.rate = isAtc ? 1.12 : 1.05 + ((seed % 7) / 40);
      u.pitch = isAtc ? 0.95 : 0.8 + ((seed % 11) / 25);
      u.volume = 0.9;
      this.queue++;
      u.onend = u.onerror = () => { this.queue = Math.max(0, this.queue - 1); };
      speechSynthesis.speak(u);
    },
    stop() { if (typeof window !== 'undefined' && window.speechSynthesis) speechSynthesis.cancel(); this.queue = 0; }
  };

  ATC.R = R;
})(ATC);
