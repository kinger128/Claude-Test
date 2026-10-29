// Music theory, the synthesized band, and hum analysis.
// Everything schedules onto any BaseAudioContext, so live playback and
// offline mixdown share the same code.

export const NOTE = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
export const MODES = {
  major: {
    steps: [0, 2, 4, 5, 7, 9, 11], q: ['', 'm', 'm', '', '', 'm', 'dim'],
    roman: ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'],
    starters: [[0, 4, 5, 3], [5, 3, 0, 4], [0, 5, 3, 4], [1, 4, 0, 0]],
  },
  minor: {
    steps: [0, 2, 3, 5, 7, 8, 10], q: ['m', 'dim', '', 'm', 'm', '', ''],
    roman: ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'],
    starters: [[0, 5, 2, 6], [0, 3, 4, 0], [0, 6, 5, 6], [0, 5, 3, 4]],
  },
};
const QUALITY = { '': [0, 4, 7], m: [0, 3, 7], dim: [0, 3, 6] };
const mod12 = (n) => ((n % 12) + 12) % 12;
const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export function chordInfo(song, deg) {
  const m = MODES[song.mode];
  const root = (song.key + m.steps[deg]) % 12;
  const ints = QUALITY[m.q[deg]];
  return {
    root, ints,
    notes: ints.map((i) => 57 + mod12(root + i - 57)),
    bass: 36 + root,
    name: NOTE[root] + m.q[deg],
    roman: m.roman[deg],
  };
}

export function defaultBand() {
  return {
    drums: { on: false, kit: 'rock', pattern: 0, vol: 0.8 },
    bass: { on: false, pattern: 1, vol: 0.8, sound: 'electric' },
    guitar: { on: false, pattern: 1, vol: 0.8, sound: 'acoustic' },
    keysVol: 0.8,
  };
}

// ---------- patterns ----------
// Drums: 16 steps per bar. x = hit, X = accent, g = ghost note.
// K kick, S snare, H closed hat, O open hat, T tom/rim/click. Crash is automatic.
export const DRUM_PATTERNS = [
  { name: 'Basic rock', K: 'x.......x.x.....', S: '....x.......x...', H: 'x.x.x.x.x.x.x.x.' },
  { name: 'Driving rock', K: 'x...x.x.x...x.x.', S: '....X.......X...', H: 'xxxxxxxxxxxxxxxx' },
  { name: 'Four on the floor', K: 'x...x...x...x...', S: '....x.......x...', H: 'x...x...x...x...', O: '..x...x...x...x.' },
  { name: 'Disco', K: 'x...x...x...x...', S: '....x.......x...', H: 'xx.xxx.xxx.xxx.x', O: '..x...x...x...x.' },
  { name: 'Half-time', K: 'x.........x.....', S: '........X.......', H: 'x.x.x.x.x.x.x.x.' },
  { name: 'Funk', K: 'x.x.......x..x..', S: '....X..g.g..X..g', H: 'xxxxxxxxxxxxxxxx' },
  { name: 'Boom bap', K: 'x......x..x.....', S: '....X.......X...', H: 'x.x.x.x.x.x.x.x.', swing: { unit: 16, amt: 0.3 } },
  { name: 'Trap', K: 'x......x..x.....', S: '........X.......', H: 'x.x.x.x.xxx.x.xx', T: '...............x' },
  { name: 'Shuffle', K: 'x.....x.x.......', S: '....x.......x...', H: 'x.x.x.x.x.x.x.x.', swing: { unit: 8, amt: 0.33 } },
  { name: 'Reggae one drop', K: '........x.......', S: '........x.......', H: '..x...x...x...x.', T: '....x.......x...' },
  { name: 'Bossa nova', K: 'x..x..x.x..x..x.', T: 'x..x...x..x..x..', H: 'x.x.x.x.x.x.x.x.' },
  { name: 'Ballad', K: 'x.......x.......', S: '....x.......x...', H: 'x...x...x...x...' },
];

// Bass: [step, note, length in steps]. Notes are relative to the chord.
export const BASS_PATTERNS = [
  { name: 'Whole notes', ev: [[0, 'R', 15.5]] },
  { name: 'Root eighths', ev: [0, 2, 4, 6, 8, 10, 12, 14].map((s) => [s, 'R', 1.6]) },
  { name: 'Root and fifth', ev: [[0, 'R', 3.6], [4, '5d', 3.6], [8, 'R', 3.6], [12, '5d', 3.6]] },
  { name: 'Octave disco', ev: [0, 2, 4, 6, 8, 10, 12, 14].map((s, i) => [s, i % 2 ? '8' : 'R', 1.4]) },
  { name: 'Walking', ev: [[0, 'R', 3.6], [4, '3', 3.6], [8, '5', 3.6], [12, '6', 3.6]] },
  { name: 'Funk', ev: [[0, 'R', 2.5], [3, 'R', 0.8], [6, '8', 1.6], [10, 'R', 0.9], [11, 'b7', 0.9], [14, '5', 1.6]] },
  { name: 'Reggae', ev: [[0, 'R', 2.6], [3, 'R', 0.8], [6, '5', 1.6], [8, '3', 3.5], [14, '5d', 1.6]] },
  { name: 'Ballad', ev: [[0, 'R', 7.5], [8, '5', 7.5]] },
  { name: 'Hip-hop sub', ev: [[0, 'R', 6], [7, 'R', 2], [10, 'R', 5.5]] },
  { name: 'Arpeggio', ev: [[0, 'R', 1.8], [2, '3', 1.8], [4, '5', 1.8], [6, '8', 1.8], [8, '5', 1.8], [10, '3', 1.8], [12, 'R', 1.8], [14, '5d', 1.8]] },
];

// Guitar: [step, stroke, length in steps].
// D down strum, U up strum, M muted chop, A accent chop, P5 power chord,
// N0-N4 one string of the chord shape, B0/B1 bass string root/fifth.
export const GUITAR_PATTERNS = [
  { name: 'Let it ring', tone: 'clean', ev: [[0, 'D', 16]] },
  { name: 'Pop strum', tone: 'clean', ev: [[0, 'D', 4], [4, 'D', 2], [6, 'U', 4], [10, 'U', 2], [12, 'D', 2], [14, 'U', 2]] },
  { name: 'Rock power chords', tone: 'drive', ev: [0, 2, 4, 6, 8, 10, 12, 14].map((s) => [s, 'P5', 1.6]) },
  { name: 'Big chords', tone: 'drive', ev: [[0, 'P5', 8], [8, 'P5', 6], [14, 'P5', 2]] },
  { name: 'Gallop', tone: 'drive', ev: [0, 2, 3, 4, 6, 7, 8, 10, 11, 12, 14, 15].map((s) => [s, 'P5', 0.9]) },
  { name: 'Arpeggio', tone: 'clean', ev: [0, 1, 2, 3, 4, 3, 2, 1].map((n, i) => [i * 2, 'N' + n, 4]) },
  { name: 'Fingerpicking', tone: 'clean', ev: [[0, 'B0', 8], [2, 'N3', 4], [4, 'N2', 4], [6, 'N4', 4], [8, 'B1', 8], [10, 'N3', 4], [12, 'N2', 4], [14, 'N4', 2]] },
  { name: 'Folk Travis', tone: 'clean', ev: [[0, 'B0', 4], [2, 'N3', 2], [4, 'B1', 4], [6, 'N4', 2], [8, 'B0', 4], [10, 'N3', 2], [12, 'B1', 4], [14, 'N2', 2]] },
  { name: 'Boom-chick', tone: 'clean', ev: [[0, 'B0', 4], [4, 'D', 2], [8, 'B1', 4], [12, 'D', 2]] },
  { name: 'Reggae skank', tone: 'clean', ev: [[4, 'M', 1], [12, 'M', 1]] },
  { name: 'Funk scratch', tone: 'clean', ev: [...'x.xx.x.xx.x.x.xx'].flatMap((c, s) => (c === 'x' ? [[s, s === 4 || s === 12 ? 'A' : 'M', 0.6]] : [])) },
];

export const KIT_NAMES = { rock: 'Rock kit', bongos: 'Bongos', electro: 'Electronic' };
export const GUITAR_SOUNDS = { acoustic: 'Acoustic', electric: 'Electric', nylon: 'Nylon', synth: 'Synth' };
export const BASS_SOUNDS = { electric: 'Electric bass', synth: 'Synth bass' };

// ---------- recorded samples ----------
// Real guitar and bass notes (tonejs-instruments, CC BY 3.0). Each note plays
// the nearest recording, re-pitched by at most a semitone or two.
const SAMPLE_NOTES = {
  'bass-electric': ['Cs1', 'E1', 'G1', 'As1', 'Cs2', 'E2', 'G2', 'As2', 'Cs3', 'E3', 'G3', 'As3', 'Cs4', 'E4', 'G4', 'As4', 'Cs5'],
  'guitar-electric': ['Cs2', 'E2', 'Fs2', 'A2', 'C3', 'Ds3', 'Fs3', 'A3', 'C4', 'Ds4', 'Fs4', 'A4', 'C5', 'Ds5', 'Fs5', 'A5', 'C6'],
  'guitar-acoustic': ['E2', 'G2', 'As2', 'Cs3', 'E3', 'G3', 'As3', 'Cs4', 'E4', 'G4', 'As4', 'Cs5'],
  'guitar-nylon': ['E2', 'Fs2', 'A2', 'B2', 'Cs3', 'E3', 'Fs3', 'A3', 'B3', 'Cs4', 'E4', 'Fs4', 'A4', 'B4', 'Cs5', 'E5'],
};
const BANK = { acoustic: 'guitar-acoustic', electric: 'guitar-electric', nylon: 'guitar-nylon' };
const PCS = { C: 0, Cs: 1, D: 2, Ds: 3, E: 4, F: 5, Fs: 6, G: 7, Gs: 8, A: 9, As: 10, B: 11 };
const noteMidi = (n) => (Number(n.slice(-1)) + 1) * 12 + PCS[n.slice(0, -1)];
const banks = new Map(), ready = new Map();
const BANK_GAIN = { 'bass-electric': 2.6, 'guitar-electric': 1.5 }; // match the synth levels

export function loadBank(c, dir) {
  if (!banks.has(dir)) {
    banks.set(dir, Promise.all(SAMPLE_NOTES[dir].map(async (n) => {
      const res = await fetch(`samples/${dir}/${n}.mp3`);
      if (!res.ok) throw new Error('sample ' + n);
      return { midi: noteMidi(n), buf: await c.decodeAudioData(await res.arrayBuffer()) };
    })).then((list) => { ready.set(dir, list); return list; })
      .catch((e) => { banks.delete(dir); throw e; }));
  }
  return banks.get(dir);
}
// Sample banks the current band settings will play.
export function banksFor(song) {
  const b = song.band, out = [];
  if (b.guitar.on && BANK[b.guitar.sound ?? 'acoustic']) out.push(BANK[b.guitar.sound ?? 'acoustic']);
  if (b.bass.on && (b.bass.sound ?? 'electric') === 'electric') out.push('bass-electric');
  return out;
}
export const bankReady = (dir) => ready.has(dir);

function sampleNote(c, dest, dir, midi, t, dur, vel, muted) {
  const list = ready.get(dir);
  if (!list) return false;
  let best = list[0];
  for (const x of list) if (Math.abs(x.midi - midi) < Math.abs(best.midi - midi)) best = x;
  const rate = Math.pow(2, (midi - best.midi) / 12);
  const src = c.createBufferSource();
  src.buffer = best.buf;
  src.playbackRate.value = rate;
  const g = c.createGain();
  const rel = muted ? 0.025 : 0.08;
  const end = t + Math.max(0.03, Math.min(dur, best.buf.duration / rate - rel - 0.02));
  vel *= BANK_GAIN[dir] || 1;
  g.gain.setValueAtTime(vel, t);
  g.gain.setValueAtTime(vel, end);
  g.gain.linearRampToValueAtTime(0, end + rel);
  src.connect(g); g.connect(dest);
  src.start(t);
  src.stop(end + rel + 0.02);
  return true;
}

// ---------- synth building blocks ----------
const noiseCache = new WeakMap();
function noise(c) {
  let b = noiseCache.get(c);
  if (!b) {
    b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(c, b);
  }
  return b;
}
function env(c, dest, t, peak, decay, attack = 0.001) {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  g.connect(dest);
  return g;
}
function tone(c, dest, t, { type = 'sine', f0, f1 = f0, sweep = 0.05, peak, decay }) {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + sweep);
  o.connect(env(c, dest, t, peak, decay));
  o.start(t);
  o.stop(t + decay + 0.05);
}
function hiss(c, dest, t, { type = 'highpass', freq, q = 0.7, peak, decay, attack }) {
  const s = c.createBufferSource();
  s.buffer = noise(c);
  const f = c.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  s.connect(f);
  f.connect(env(c, dest, t, peak, decay, attack));
  s.start(t, Math.random() * 0.3);
  s.stop(t + decay + 0.05);
}
function metal(c, dest, t, peak, decay) {
  const hp = c.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 7000;
  hp.connect(env(c, dest, t, peak, decay));
  for (const r of [2, 3, 4.16, 5.43, 6.79, 8.21]) {
    const o = c.createOscillator();
    o.type = 'square'; o.frequency.value = 40 * r;
    o.connect(hp);
    o.start(t); o.stop(t + decay + 0.05);
  }
}

const KITS = {
  rock: {
    K: (c, d, t, v) => { tone(c, d, t, { f0: 150, f1: 45, sweep: 0.12, peak: v, decay: 0.4 }); hiss(c, d, t, { type: 'lowpass', freq: 3000, peak: 0.3 * v, decay: 0.01 }); },
    S: (c, d, t, v) => { hiss(c, d, t, { freq: 1200, peak: 0.55 * v, decay: 0.18 }); tone(c, d, t, { type: 'triangle', f0: 200, f1: 170, peak: 0.35 * v, decay: 0.1 }); },
    H: (c, d, t, v) => hiss(c, d, t, { freq: 7500, peak: 0.22 * v, decay: 0.045 }),
    O: (c, d, t, v) => hiss(c, d, t, { freq: 7000, peak: 0.2 * v, decay: 0.32 }),
    T: (c, d, t, v) => tone(c, d, t, { f0: 140, f1: 95, sweep: 0.2, peak: 0.6 * v, decay: 0.35 }),
    C: (c, d, t, v) => hiss(c, d, t, { freq: 4500, peak: 0.22 * v, decay: 1.4 }),
  },
  bongos: {
    K: (c, d, t, v) => { tone(c, d, t, { f0: 210, f1: 180, peak: 0.7 * v, decay: 0.28 }); hiss(c, d, t, { type: 'bandpass', freq: 400, peak: 0.2 * v, decay: 0.02 }); },
    S: (c, d, t, v) => { tone(c, d, t, { f0: 440, f1: 400, peak: 0.55 * v, decay: 0.09 }); hiss(c, d, t, { type: 'bandpass', freq: 2500, q: 1, peak: 0.35 * v, decay: 0.03 }); },
    H: (c, d, t, v) => hiss(c, d, t, { type: 'bandpass', freq: 6500, q: 1.2, peak: 0.18 * v, decay: 0.05, attack: 0.012 }),
    O: (c, d, t, v) => hiss(c, d, t, { type: 'bandpass', freq: 6000, q: 1.2, peak: 0.18 * v, decay: 0.14, attack: 0.02 }),
    T: (c, d, t, v) => tone(c, d, t, { f0: 330, f1: 300, peak: 0.5 * v, decay: 0.14 }),
    C: (c, d, t, v) => { tone(c, d, t, { type: 'square', f0: 545, peak: 0.08 * v, decay: 0.25 }); tone(c, d, t, { type: 'square', f0: 815, peak: 0.06 * v, decay: 0.25 }); },
  },
  electro: {
    K: (c, d, t, v) => { tone(c, d, t, { f0: 170, f1: 46, sweep: 0.06, peak: 1.1 * v, decay: 0.9 }); hiss(c, d, t, { type: 'lowpass', freq: 5000, peak: 0.45 * v, decay: 0.006 }); },
    S: (c, d, t, v) => {
      for (let i = 0; i < 3; i++) hiss(c, d, t + i * 0.011, { type: 'bandpass', freq: 1400, q: 0.8, peak: 0.5 * v, decay: 0.012 });
      hiss(c, d, t + 0.025, { type: 'bandpass', freq: 1400, q: 0.8, peak: 0.35 * v, decay: 0.16 });
    },
    H: (c, d, t, v) => metal(c, d, t, 0.18 * v, 0.045),
    O: (c, d, t, v) => metal(c, d, t, 0.16 * v, 0.28),
    T: (c, d, t, v) => tone(c, d, t, { type: 'square', f0: 1900, peak: 0.25 * v, decay: 0.018 }),
    C: (c, d, t, v) => hiss(c, d, t, { freq: 5000, peak: 0.2 * v, decay: 1.0 }),
  },
};

export function keysChord(c, dest, ch, t, dur) {
  const out = c.createGain();
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 1700; lp.Q.value = 0.4;
  lp.connect(out); out.connect(dest);
  const g = out.gain, end = t + dur;
  g.setValueAtTime(0, t);
  g.linearRampToValueAtTime(0.16, t + 0.03);
  g.setTargetAtTime(0.1, t + 0.03, 0.4);
  g.setValueAtTime(0.1, Math.max(t + 0.05, end - 0.08));
  g.linearRampToValueAtTime(0, end + 0.04);
  const voice = (freq, type, level) => {
    const o = c.createOscillator(), v = c.createGain();
    o.type = type; o.frequency.value = freq; v.gain.value = level;
    o.connect(v); v.connect(lp);
    o.start(t); o.stop(end + 0.1);
  };
  for (const n of ch.notes) { voice(midiHz(n), 'triangle', 0.5); voice(midiHz(n) * 1.003, 'sawtooth', 0.12); }
  voice(midiHz(ch.bass), 'triangle', 0.7);
}

function bassNote(c, dest, midi, t, dur, sub) {
  const f = midiHz(midi), end = t + Math.max(0.08, dur);
  const g = c.createGain();
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass'; lp.Q.value = sub ? 1 : 5;
  lp.frequency.setValueAtTime(sub ? 400 : 1100, t);
  lp.frequency.exponentialRampToValueAtTime(sub ? 250 : 280, t + 0.25);
  lp.connect(g); g.connect(dest);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.7, t + 0.008);
  if (end - 0.03 > t + 0.01) g.gain.exponentialRampToValueAtTime(0.45, end - 0.03);
  g.gain.linearRampToValueAtTime(0, end + 0.03);
  for (const [type, level] of [['sawtooth', sub ? 0.15 : 0.6], ['sine', sub ? 1.1 : 0.8]]) {
    const o = c.createOscillator(), v = c.createGain();
    o.type = type; o.frequency.value = f; v.gain.value = level;
    o.connect(v); v.connect(lp);
    o.start(t); o.stop(end + 0.05);
  }
}
function bassMidi(ch, tok) {
  const base = 33 + mod12(ch.root - 33);
  const off = { R: 0, 3: ch.ints[1], 5: ch.ints[2], '5d': ch.ints[2] - 12, 8: 12, 6: 9, b7: 10 }[tok] ?? 0;
  return base + off;
}

// Plucked string (Karplus-Strong), rendered once per note and cached.
const ksCache = new Map();
function ksBuffer(c, midi, muted) {
  const sr = c.sampleRate, key = sr + ':' + midi + ':' + muted;
  let e = ksCache.get(key);
  if (e) return e;
  const f = midiHz(midi);
  const N = Math.max(2, Math.floor(sr / f - 0.5));
  const len = Math.floor(sr * (muted ? 0.25 : 2.2));
  const d = new Float32Array(len);
  let prev = 0;
  for (let i = 0; i < N; i++) { const r = Math.random() * 2 - 1; prev = muted ? (r + prev) * 0.5 : r * 0.7 + prev * 0.3; d[i] = prev; }
  const loss = muted ? 0.97 : 0.996;
  for (let i = N; i < len; i++) d[i] = 0.5 * (d[i - N] + (i - N - 1 >= 0 ? d[i - N - 1] : 0)) * loss;
  let m = 0;
  for (let i = 0; i < len; i++) m = Math.max(m, Math.abs(d[i]));
  if (m > 0) for (let i = 0; i < len; i++) d[i] /= m;
  const buf = c.createBuffer(1, len, sr);
  buf.copyToChannel(d, 0);
  e = { buf, rate: f / (sr / (N + 0.5)) };
  ksCache.set(key, e);
  return e;
}
function pluck(c, dest, midi, t, dur, vel, muted = false) {
  const { buf, rate } = ksBuffer(c, midi, muted);
  const s = c.createBufferSource();
  s.buffer = buf;
  s.playbackRate.value = rate;
  const g = c.createGain();
  const end = t + Math.min(dur, buf.duration - 0.1);
  g.gain.setValueAtTime(vel, t);
  g.gain.setValueAtTime(vel, end);
  g.gain.linearRampToValueAtTime(0, end + 0.06);
  s.connect(g); g.connect(dest);
  s.start(t);
  s.stop(end + 0.08);
}
function guitarEvent(ch, stroke, t, dur, pluck) {
  const gr = 40 + mod12(ch.root - 40);
  const [, i3, i5] = ch.ints;
  const shape = [gr, gr + i5, gr + 12, gr + 12 + i3, gr + 12 + i5];
  switch (stroke) {
    case 'D': shape.forEach((m, i) => pluck(m, t + i * 0.012, dur, 0.45)); break;
    case 'U': shape.slice(2).reverse().forEach((m, i) => pluck(m, t + i * 0.01, dur, 0.35)); break;
    case 'M': shape.slice(1).forEach((m, i) => pluck(m, t + i * 0.004, Math.min(dur, 0.07), 0.4, true)); break;
    case 'A': shape.forEach((m, i) => pluck(m, t + i * 0.006, Math.min(dur, 0.12), 0.55, true)); break;
    case 'P5': [gr, gr + 7, gr + 12].forEach((m, i) => pluck(m, t + i * 0.004, dur, 0.5)); break;
    case 'B0': pluck(gr, t, dur, 0.55); break;
    case 'B1': pluck(gr + i5 - (gr + i5 - 12 >= 40 ? 12 : 0), t, dur, 0.55); break;
    default: pluck(shape[Number(stroke.slice(1))] ?? gr, t, dur, 0.5);
  }
}

// ---------- mixing ----------
// One bus per instrument, so volumes can change while the band plays.
export function makeBand(c, dest, song) {
  const bus = (vol) => { const g = c.createGain(); g.gain.value = vol; g.connect(dest); return g; };
  const b = song.band;
  const out = {
    keys: bus(0.6 * b.keysVol),
    drums: bus(0.7 * b.drums.vol),
    bass: bus(0.35 * b.bass.vol),
    guitar: bus(0.5 * b.guitar.vol),
  };
  out.clean = c.createBiquadFilter();
  out.clean.type = 'lowpass'; out.clean.frequency.value = 6000;
  out.clean.connect(out.guitar);
  const pre = c.createGain();
  pre.gain.value = 3;
  const shaper = c.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) { const x = (i / 511.5) - 1; curve[i] = Math.tanh(4 * x); }
  shaper.curve = curve;
  const tame = c.createBiquadFilter();
  tame.type = 'lowpass'; tame.frequency.value = 3200;
  const post = c.createGain();
  post.gain.value = 0.3;
  pre.connect(shaper); shaper.connect(tame); tame.connect(post); post.connect(out.guitar);
  out.drive = pre;
  return out;
}
export function setBandLevels(out, song) {
  if (!out) return;
  const b = song.band;
  out.keys.gain.value = 0.6 * b.keysVol;
  out.drums.gain.value = 0.7 * b.drums.vol;
  out.bass.gain.value = 0.35 * b.bass.vol;
  out.guitar.gain.value = 0.5 * b.guitar.vol;
}

export const bandPlaying = (song) =>
  !!song && ((song.chordsInMix && song.prog.length > 0) || song.band.drums.on || song.band.bass.on || song.band.guitar.on);

function swingDelay(p, s, sd) {
  const sw = p?.swing;
  if (!sw) return 0;
  if (sw.unit === 8) return s % 4 === 2 ? sw.amt * 2 * sd : 0;
  return s % 2 === 1 ? sw.amt * sd : 0;
}

// Schedules everything that starts on one 16th-note step.
export function scheduleStep(c, out, song, step, t, sd) {
  const s = step % 16, bar = Math.floor(step / 16), b = song.band;
  const prog = song.prog.length ? song.prog : [0];
  const ch = chordInfo(song, prog[bar % prog.length]);
  const dp = b.drums.on ? DRUM_PATTERNS[b.drums.pattern] || DRUM_PATTERNS[0] : null;
  const tt = t + swingDelay(dp, s, sd);

  if (song.chordsInMix && song.prog.length && s === 0) keysChord(c, out.keys, ch, t, 16 * sd);
  if (dp) {
    const kit = KITS[b.drums.kit] || KITS.rock;
    for (const v of ['K', 'S', 'H', 'O', 'T']) {
      const hit = dp[v]?.[s];
      if (hit && hit !== '.') kit[v](c, out.drums, tt, hit === 'X' ? 1 : hit === 'g' ? 0.35 : 0.8);
    }
    if (s === 0 && bar % 8 === 0 && b.drums.kit !== 'bongos') kit.C(c, out.drums, tt, 0.8);
  }
  if (b.bass.on) {
    const p = BASS_PATTERNS[b.bass.pattern] || BASS_PATTERNS[0];
    const real = (b.bass.sound ?? 'electric') === 'electric';
    for (const [st, tok, len] of p.ev) {
      if (st !== s) continue;
      const m = bassMidi(ch, tok);
      if (!(real && sampleNote(c, out.bass, 'bass-electric', m, tt, len * sd, 0.9, false))) {
        bassNote(c, out.bass, m, tt, len * sd, !real || (b.drums.kit === 'electro' && b.drums.on));
      }
    }
  }
  if (b.guitar.on) {
    const p = GUITAR_PATTERNS[b.guitar.pattern] || GUITAR_PATTERNS[0];
    const dest = p.tone === 'drive' ? out.drive : out.clean;
    const bank = BANK[b.guitar.sound ?? 'acoustic'];
    const play = (m, at, d, vel, muted = false) => {
      if (!(bank && sampleNote(c, dest, bank, m, at, d, vel, muted))) pluck(c, dest, m, at, d, vel, muted);
    };
    for (const [st, stroke, len] of p.ev) if (st === s) guitarEvent(ch, stroke, tt, len * sd, play);
  }
}

// ---------- hum analysis ----------
// Pitch-tracks a take (YIN on an ~11 kHz copy), then finds the key and one
// chord per bar that fits the melody.
export function trackPitch(buf, trackStart) {
  const sr0 = buf.sampleRate, x0 = buf.getChannelData(0);
  const ds = Math.max(1, Math.round(sr0 / 11025)), sr = sr0 / ds;
  const n = Math.floor(x0.length / ds);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) { let a = 0; for (let k = 0; k < ds; k++) a += x0[i * ds + k]; x[i] = a / ds; }

  const W = 512, hop = 128, minLag = Math.floor(sr / 1000), maxLag = Math.ceil(sr / 70);
  const rms = [];
  for (let i = 0; i + W + maxLag < n; i += hop) {
    let e = 0;
    for (let j = 0; j < W; j++) e += x[i + j] * x[i + j];
    rms.push(Math.sqrt(e / W));
  }
  const peak = rms.reduce((m, v) => Math.max(m, v), 0);
  const gate = Math.max(0.008, peak * 0.1);
  const d = new Float32Array(maxLag + 1);
  const frames = [];
  for (let f = 0; f < rms.length; f++) {
    if (rms[f] < gate) continue;
    const i = f * hop;
    let run = 0;
    d[0] = 1;
    for (let tau = 1; tau <= maxLag; tau++) {
      let s = 0;
      for (let j = 0; j < W; j++) { const v = x[i + j] - x[i + j + tau]; s += v * v; }
      run += s;
      d[tau] = run > 0 ? (s * tau) / run : 1;
    }
    let tau = -1;
    for (let k = minLag; k < maxLag; k++) {
      if (d[k] < 0.2) { while (k + 1 < maxLag && d[k + 1] < d[k]) k++; tau = k; break; }
    }
    if (tau < 0) continue;
    const a = d[tau - 1], b = d[tau], c2 = d[tau + 1];
    const den = a - 2 * b + c2;
    const exact = den ? tau + (a - c2) / (2 * den) : tau;
    const hz = sr / exact;
    if (hz < 70 || hz > 1000) continue;
    frames.push({ t: trackStart + i / sr, midi: 69 + 12 * Math.log2(hz / 440), w: (1 - b) * (hop / sr) });
  }
  return frames;
}

const PROFILE = {
  major: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
  minor: [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
};
function corr(a, b) {
  const ma = a.reduce((s, v) => s + v, 0) / 12, mb = b.reduce((s, v) => s + v, 0) / 12;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < 12; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da && db ? num / Math.sqrt(da * db) : 0;
}
const PRIOR = {
  major: [0.10, 0.02, 0, 0.07, 0.07, 0.05, -0.25],
  minor: [0.10, -0.25, 0.04, 0.06, 0.04, 0.06, 0.05],
};

export function fitSong(frames, bpm) {
  const voiced = frames.reduce((s, f) => s + f.w, 0);
  if (frames.length < 20 || voiced < 0.5) return null;

  // People hum slightly sharp or flat; find the shared offset before rounding.
  let sx = 0, sy = 0;
  for (const f of frames) { const a = 2 * Math.PI * (f.midi - Math.round(f.midi)); sx += Math.cos(a) * f.w; sy += Math.sin(a) * f.w; }
  const tune = Math.atan2(sy, sx) / (2 * Math.PI);
  const notes = frames.map((f) => ({ t: f.t, w: f.w, pc: mod12(Math.round(f.midi - tune)) }));

  const hist = new Array(12).fill(0);
  for (const nt of notes) hist[nt.pc] += nt.w;
  let best = { score: -2 };
  for (const mode of ['major', 'minor']) {
    for (let key = 0; key < 12; key++) {
      const rotated = hist.map((_, i) => hist[(i + key) % 12]);
      const score = corr(rotated, PROFILE[mode]);
      if (score > best.score) best = { score, key, mode };
    }
  }

  const barLen = 240 / bpm;
  const lastT = notes.reduce((m, nt) => Math.max(m, nt.t), 0);
  const bars = Math.min(32, Math.max(1, Math.floor(lastT / barLen) + 1));
  const perBar = Array.from({ length: bars }, () => new Array(12).fill(0));
  for (const nt of notes) {
    const b = Math.floor(nt.t / barLen);
    if (b >= 0 && b < bars) perBar[b][nt.pc] += nt.w;
  }

  const song = { key: best.key, mode: best.mode };
  const m = MODES[best.mode];
  const prog = [];
  let prev = 0;
  for (let b = 0; b < bars; b++) {
    const h = perBar[b], total = h.reduce((s, v) => s + v, 0);
    if (total < 0.05) { prog.push(prev); continue; }
    let pick = 0, top = -Infinity;
    for (let deg = 0; deg < 7; deg++) {
      const { root, ints } = chordInfo(song, deg);
      const inChord = h[root] + h[(root + ints[1]) % 12] + h[(root + ints[2]) % 12];
      const fit = (h[root] + 0.9 * h[(root + ints[1]) % 12] + 0.75 * h[(root + ints[2]) % 12] - 0.35 * (total - inChord)) / total;
      const score = fit + PRIOR[best.mode][deg] + (b === 0 && deg === 0 ? 0.08 : 0) + (deg === prev ? 0.02 : 0);
      if (score > top) { top = score; pick = deg; }
    }
    prog.push(pick);
    prev = pick;
  }
  // Trim trailing bars that only repeat silence at the end.
  while (prog.length > 1 && perBar[prog.length - 1].every((v) => v < 0.05)) prog.pop();
  // Relative keys share notes; a song that opens on III of a minor key reads as the major key.
  if (best.mode === 'minor' && prog[0] === 2) {
    best = { ...best, key: (best.key + 3) % 12, mode: 'major' };
    for (let i = 0; i < prog.length; i++) prog[i] = (prog[i] + 5) % 7;
    song.key = best.key; song.mode = best.mode;
  }
  return { key: best.key, mode: best.mode, prog, confidence: best.score, name: NOTE[best.key] + ' ' + best.mode, chordNames: prog.map((d) => chordInfo(song, d).name) };
}
