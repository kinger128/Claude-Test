// Takes: a songwriting sketchpad. Songs, takes, lyrics and chords live in
// IndexedDB on this device. Audio runs through one shared AudioContext.

import {
  NOTE, MODES, chordInfo, defaultBand, keysChord, makeBand, setBandLevels, bandPlaying, scheduleStep,
  DRUM_PATTERNS, BASS_PATTERNS, GUITAR_PATTERNS, KIT_NAMES, trackPitch, fitSong,
} from './band.js';

const $ = (s, r = document) => r.querySelector(s);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

const PPS = 50; // waveform peaks per second
// ---------- settings (per device) ----------
const pref = {
  get(k, d) { try { const v = localStorage.getItem('takes.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('takes.' + k, JSON.stringify(v)); } catch {} },
};
let metroOn = pref.get('metro', false);

// ---------- storage ----------
let dbPromise;
function db() {
  return dbPromise ??= new Promise((res, rej) => {
    const r = indexedDB.open('takes', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('songs', { keyPath: 'id' });
      d.createObjectStore('tracks', { keyPath: 'id' }).createIndex('songId', 'songId');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    let out;
    const req = fn(t.objectStore(store));
    if (req) req.onsuccess = () => { out = req.result; };
    t.oncomplete = () => res(out);
    t.onerror = t.onabort = () => rej(t.error);
  });
}
const put = (store, obj) => tx(store, 'readwrite', (s) => s.put(obj));
const del = (store, id) => tx(store, 'readwrite', (s) => s.delete(id));
const getAll = (store) => tx(store, 'readonly', (s) => s.getAll());
const tracksOf = (songId) => tx('tracks', 'readonly', (s) => s.index('songId').getAll(songId));

// ---------- state ----------
const S = { song: null, tracks: [], tab: 'tracks', L: 0 };
const buffers = new Map(); // track id -> AudioBuffer

// ---------- audio core ----------
let ctx, master, workletReady = false;
function audio() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    master = ctx.createGain();
    master.connect(ctx.destination);
  }
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
  return ctx;
}
function setSession(type) {
  try { if (navigator.audioSession) navigator.audioSession.type = type; } catch {}
}
function latency() {
  return (ctx.baseLatency || 0) + (ctx.outputLatency || 0) + pref.get('latencyMs', 0) / 1000;
}
async function bufferFor(t) {
  if (buffers.has(t.id)) return buffers.get(t.id);
  const buf = await audio().decodeAudioData(t.data.slice(0));
  buffers.set(t.id, buf);
  return buf;
}

const chordNotes = (deg) => chordInfo(S.song, deg);
function click(c, dest, t, accent) {
  const o = c.createOscillator(), g = c.createGain();
  o.type = 'square'; o.frequency.value = accent ? 1760 : 1100;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(accent ? 0.35 : 0.2, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  o.connect(g); g.connect(dest);
  o.start(t); o.stop(t + 0.06);
}
// ---------- transport ----------
const T = { playing: false, recording: false, busy: false, pos: 0, startPos: 0, startCtx: 0, voices: [], timer: 0, nextStep: 0, countLeft: 0, countIn: 0, bus: null, out: null };
let R = null; // the take being recorded

const beatLen = () => 60 / (S.song?.bpm || 90);
const songEnd = () => S.tracks.reduce((m, t) => Math.max(m, t.start + t.duration), 0);
const chordsActive = () => !!(S.song?.chordsInMix && S.song.prog.length);
const bandOn = () => bandPlaying(S.song);
const songTime = () => (T.playing ? T.startPos + (ctx.currentTime - T.startCtx) : T.pos);

async function play({ countIn = 0 } = {}) {
  if (T.playing || T.busy) return;
  T.busy = true;
  const c = audio();
  if (!T.recording) setSession('playback');
  const live = S.tracks.filter((t) => !t.muted);
  try { await Promise.all(live.map(bufferFor)); } catch { toast('One take could not be loaded.'); }
  T.busy = false;
  if (!T.recording && !bandOn() && !metroOn && T.pos >= songEnd() - 0.05) T.pos = 0;

  const beat = beatLen();
  T.startPos = T.pos;
  T.startCtx = c.currentTime + 0.12 + countIn * beat;
  T.bus = c.createGain();
  T.bus.connect(master);
  T.voices = [];
  for (const t of live) {
    const buf = buffers.get(t.id);
    if (!buf) continue;
    const off = T.startPos - t.start;
    if (off >= buf.duration) continue;
    const g = c.createGain();
    g.gain.value = t.volume;
    g.connect(T.bus);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(g);
    if (off >= 0) src.start(T.startCtx, off); else src.start(T.startCtx - off);
    T.voices.push(src);
  }
  T.countIn = T.countLeft = countIn;
  T.out = makeBand(c, T.bus, S.song);
  T.nextStep = Math.ceil(T.startPos / (beat / 4) - 1e-6);
  if (chordsActive()) {
    const barLen = 4 * beat, bar = Math.floor(T.startPos / barLen), into = T.startPos - bar * barLen;
    if (into > 0.01 && barLen - into > 0.05) keysChord(c, T.out.keys, chordNotes(S.song.prog[bar % S.song.prog.length]), T.startCtx, barLen - into);
  }
  T.playing = true;
  schedule();
  T.timer = setInterval(schedule, 25);
  renderTransport();
  requestAnimationFrame(tick);
}

function schedule() {
  if (!T.playing) return;
  const c = ctx, ahead = c.currentTime + 0.2, beat = beatLen();
  while (T.countLeft > 0) {
    const t = T.startCtx - T.countLeft * beat;
    if (t > ahead) break;
    click(c, T.bus, t, T.countLeft === T.countIn);
    T.countLeft--;
  }
  const sd = beat / 4;
  for (;;) {
    const t = T.startCtx + (T.nextStep * sd - T.startPos);
    if (t > ahead) break;
    if (t >= c.currentTime - 0.02) {
      if (metroOn && T.nextStep % 4 === 0) click(c, T.bus, t, T.nextStep % 16 === 0);
      scheduleStep(c, T.out, S.song, T.nextStep, t, sd);
    }
    T.nextStep++;
  }
  if (!T.recording && !bandOn() && !metroOn && songTime() > songEnd() + 0.15) {
    stop().then(() => { T.pos = 0; renderTransport(); placePlayheads(); });
  }
}

async function stop() {
  if (!T.playing) return;
  const end = songTime();
  clearInterval(T.timer);
  T.playing = false;
  for (const v of T.voices) { try { v.stop(); } catch {} }
  T.voices = [];
  const bus = T.bus;
  T.bus = null;
  T.out = null;
  if (bus) { bus.gain.setTargetAtTime(0, ctx.currentTime, 0.015); setTimeout(() => bus.disconnect(), 300); }
  T.pos = Math.max(0, end);
  if (T.recording) await finishRecording();
  setSession('playback');
  renderTransport();
  renderTracks();
}

// ---------- recording ----------
let wakeLock = null;
async function record() {
  if (T.recording) return stop();
  if (T.busy) return;
  if (T.playing) await stop();
  const c = audio();
  if (!navigator.mediaDevices?.getUserMedia || !c.audioWorklet) {
    toast('This browser cannot record audio. Try Safari or Chrome.');
    return;
  }
  T.busy = true;
  setSession('play-and-record');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch {
    T.busy = false;
    setSession('playback');
    toast('The microphone is blocked. Allow it in your browser settings, then try again.');
    return;
  }
  try {
    if (!workletReady) { await c.audioWorklet.addModule('recorder-worklet.js'); workletReady = true; }
    await c.resume();
  } catch {
    T.busy = false;
    stream.getTracks().forEach((t) => t.stop());
    toast('Recording could not start. Reload the app and try again.');
    return;
  }
  navigator.storage?.persist?.().catch(() => {});

  const src = c.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(c, 'rec-tap');
  const sink = c.createGain();
  sink.gain.value = 0;
  src.connect(node); node.connect(sink); sink.connect(c.destination);

  const per = Math.round(c.sampleRate / PPS);
  const r = { stream, src, node, sink, chunks: [], len: 0, first: null, peaks: [], acc: 0, accMax: 0, level: 0 };
  r.done = new Promise((res) => {
    node.port.onmessage = (e) => {
      const m = e.data;
      if (m.done) { res(); return; }
      if (r.first === null) r.first = m.frame;
      const gap = m.frame - (r.first + r.len); // fill dropped frames with silence
      if (gap > 0 && gap < c.sampleRate) { r.chunks.push(new Float32Array(gap)); r.len += gap; }
      r.chunks.push(m.data);
      r.len += m.data.length;
      let lvl = 0;
      for (let i = 0; i < m.data.length; i++) {
        const a = Math.abs(m.data[i]);
        if (a > lvl) lvl = a;
        if (a > r.accMax) r.accMax = a;
        if (++r.acc >= per) { r.peaks.push(shape(r.accMax)); r.acc = 0; r.accMax = 0; }
      }
      r.level = Math.max(lvl, r.level * 0.85);
    };
  });
  R = r;
  T.recording = true;
  T.busy = false;
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
  showTab('tracks');
  await play({ countIn: metroOn ? 4 : 0 });
}

const shape = (a) => Math.round(Math.pow(Math.min(1, a), 0.7) * 255);

async function finishRecording() {
  const r = R;
  R = null;
  T.recording = false;
  try { await wakeLock?.release(); } catch {}
  wakeLock = null;
  r.node.port.postMessage('stop');
  await Promise.race([r.done, wait(600)]);
  r.src.disconnect(); r.node.disconnect(); r.sink.disconnect();
  r.stream.getTracks().forEach((t) => t.stop());
  $('#meterFill').style.width = '0';
  T.pos = T.startPos;
  if (r.first === null || !r.len) { toast('Nothing was recorded. Check the microphone.'); return; }

  const sr = ctx.sampleRate;
  let pcm = new Float32Array(r.len), o = 0;
  for (const ch of r.chunks) { pcm.set(ch, o); o += ch.length; }
  // Map the first sample to song time, then remove what came before the record point.
  let start = T.startPos + (r.first / sr - T.startCtx) - latency();
  const cut = Math.round((T.startPos - start) * sr);
  if (cut > 0) { pcm = pcm.subarray(Math.min(cut, pcm.length)); start = T.startPos; }
  if (pcm.length < sr * 0.3) { toast('That take was too short, so it was not saved.'); return; }

  const n = S.tracks.length;
  const track = {
    id: uid(), songId: S.song.id, name: 'Take ' + (n + 1), color: n % 6,
    data: encodeWav([pcm], sr), sampleRate: sr, duration: pcm.length / sr, start,
    volume: 1, muted: false, peaks: peaksOf(pcm, sr), createdAt: Date.now(),
  };
  const buf = ctx.createBuffer(1, pcm.length, sr);
  buf.copyToChannel(pcm, 0);
  buffers.set(track.id, buf);
  S.tracks.push(track);
  try {
    await put('tracks', track);
    await saveSong();
    toast(track.name + ' saved');
  } catch {
    toast('Could not save the take. Your device may be out of storage.');
  }
}

function peaksOf(pcm, sr) {
  const per = Math.round(sr / PPS), out = [];
  for (let i = 0; i < pcm.length; i += per) {
    let m = 0;
    const e = Math.min(pcm.length, i + per);
    for (let j = i; j < e; j++) { const a = Math.abs(pcm[j]); if (a > m) m = a; }
    out.push(shape(m));
  }
  return out;
}

function encodeWav(chs, sr) {
  const n = chs[0].length, nc = chs.length, bytes = n * nc * 2;
  const buf = new ArrayBuffer(44 + bytes), v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); w(8, 'WAVE');
  w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nc, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * nc * 2, true); v.setUint16(32, nc * 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, bytes, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nc; c++) {
      const s = Math.max(-1, Math.min(1, chs[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return buf;
}

// ---------- export & share ----------
async function exportMix() {
  const live = S.tracks.filter((t) => !t.muted);
  let end = live.reduce((m, t) => Math.max(m, t.start + t.duration), 0);
  if (!end && bandOn()) end = Math.max(S.song.prog.length, 4) * 4 * beatLen();
  if (!end) { toast('Record a take first.'); return; }
  closeSheet();
  toast('Mixing…', 60000);
  try {
    const c = audio();
    await Promise.all(live.map(bufferFor));
    const sr = c.sampleRate;
    const oc = new OfflineAudioContext(2, Math.ceil((end + 1) * sr), sr);
    for (const t of live) {
      const g = oc.createGain();
      g.gain.value = t.volume;
      g.connect(oc.destination);
      const s = oc.createBufferSource();
      s.buffer = buffers.get(t.id);
      s.connect(g);
      s.start(Math.max(0, t.start), Math.max(0, -t.start));
    }
    if (bandOn()) {
      const out = makeBand(oc, oc.destination, S.song), sd = beatLen() / 4;
      for (let step = 0; step * sd < end; step++) scheduleStep(oc, out, S.song, step, step * sd, sd);
    }
    const out = await oc.startRendering();
    const wav = encodeWav([out.getChannelData(0), out.getChannelData(1)], sr);
    hideToast();
    offerFile(wav, fileName(S.song.title) + '.wav', 'Your mix is ready');
  } catch {
    hideToast();
    toast('The mix could not be made. Try again.');
  }
}
const fileName = (s) => (s || 'Takes').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'Takes';

// Sharing needs a fresh tap, so the file waits behind a button.
function offerFile(data, name, title) {
  openSheet(`<h3>${esc(title)}</h3><p>${esc(name)} · ${(data.byteLength / 1048576).toFixed(1)} MB</p>
    <div class="sheet-row"><button class="btn ghost" data-close type="button">Close</button>
    <button class="btn primary" id="shareNow" type="button">Share or save</button></div>`);
  $('#shareNow').onclick = async () => {
    const file = new File([data], name, { type: 'audio/wav' });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); closeSheet(); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    closeSheet();
  };
}

// ---------- persistence helpers ----------
async function saveSong() {
  if (!S.song) return;
  S.song.updatedAt = Date.now();
  S.song.takes = S.tracks.length;
  S.song.length = songEnd();
  await put('songs', S.song);
}
const debounced = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const saveSongSoon = debounced(() => saveSong().catch(() => toast('Could not save. Your device may be out of storage.')), 400);
const saveTrackSoon = (() => {
  const timers = new Map();
  return (t) => { clearTimeout(timers.get(t.id)); timers.set(t.id, setTimeout(() => put('tracks', t).catch(() => {}), 400)); };
})();

// ---------- library ----------
const fmtDate = (ms) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
function fmtTime(s, tenths = true) {
  const neg = s < 0; s = Math.abs(s);
  const m = Math.floor(s / 60), sec = s - m * 60;
  const ss = tenths ? sec.toFixed(1).padStart(4, '0') : String(Math.floor(sec)).padStart(2, '0');
  return (neg ? '-' : '') + m + ':' + ss;
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function showLibrary() {
  await stop();
  S.song = null; S.tracks = [];
  buffers.clear();
  $('#song').hidden = true;
  $('#library').hidden = false;
  const songs = (await getAll('songs')).sort((a, b) => b.updatedAt - a.updatedAt);
  $('#emptyLib').hidden = songs.length > 0;
  $('#songList').innerHTML = songs.map((s) => `
    <li><button class="song-item" type="button" data-id="${s.id}">
      <span class="si-title">${esc(s.title || 'Untitled')}</span>
      <span class="si-date">${fmtDate(s.updatedAt)}</span>
      <span class="si-meta">${s.takes || 0} ${s.takes === 1 ? 'take' : 'takes'} · ${fmtTime(s.length || 0, false)}${s.prog?.length ? ' · ' + s.prog.length + ' chords' : ''}</span>
    </button></li>`).join('');
}

function newSongObj(title) {
  const now = Date.now();
  return { id: uid(), title, createdAt: now, updatedAt: now, lyrics: '', key: 0, mode: 'major', bpm: 90, prog: [], chordsInMix: true, band: defaultBand(), takes: 0, length: 0 };
}
const ideaTitle = () => 'Idea · ' + new Date().toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

async function openSong(song) {
  song.band ??= defaultBand();
  S.song = song;
  S.tracks = (await tracksOf(song.id)).sort((a, b) => a.createdAt - b.createdAt);
  T.pos = 0;
  S.L = 0;
  $('#library').hidden = true;
  $('#song').hidden = false;
  $('#songTitle').value = song.title;
  $('#lyrics').value = song.lyrics || '';
  renderChords();
  showTab('tracks');
  renderTransport();
}

// ---------- song view ----------
function showTab(name) {
  S.tab = name;
  for (const b of document.querySelectorAll('.tabs [role=tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === name));
  for (const p of ['tracks', 'lyrics', 'chords', 'band']) $('#pane-' + p).hidden = p !== name;
  if (name === 'tracks') renderTracks();
  if (name === 'chords') highlightChord();
  if (name === 'band') renderBand();
}

function timelineLen() {
  let end = songEnd();
  if (T.recording || T.playing) end = Math.max(end, songTime());
  return Math.max(16, Math.ceil((end + 4) / 8) * 8);
}

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const color = (i) => cssVar('--t' + ((i % 6) + 1));

function renderTracks() {
  const list = $('#trackList');
  const html = S.tracks.map((t, i) => `
    <article class="track${t.muted ? ' is-muted' : ''}" data-id="${t.id}" style="--tc:${color(t.color)}">
      <div class="track-top">
        <span class="tr-no">TR ${i + 1}</span>
        <input class="tr-name" value="${esc(t.name)}" aria-label="Take name" id="name-${t.id}">
        <button class="tr-btn" data-act="mute" aria-pressed="${t.muted}" type="button" aria-label="Mute">M</button>
        <button class="tr-btn" data-act="more" type="button" aria-label="Take options">
          <svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="19" cy="12" r="1.8" fill="currentColor"/></svg>
        </button>
      </div>
      <div class="wave"><canvas></canvas><div class="ph"></div></div>
      <div class="vol-row"><span>Vol</span><input type="range" min="0" max="1.5" step="0.01" value="${t.volume}" id="vol-${t.id}" aria-label="Volume"><output>${Math.round(t.volume * 100)}</output></div>
    </article>`).join('');
  const recCard = T.recording ? `
    <article class="track is-recording" data-id="rec" style="--tc:var(--red)">
      <div class="track-top"><span class="tr-no">TR ${S.tracks.length + 1}</span><span class="tr-name">Recording…</span></div>
      <div class="wave"><canvas></canvas><div class="ph"></div></div>
    </article>` : '';
  list.innerHTML = html + recCard;
  $('#emptyTracks').hidden = S.tracks.length > 0 || T.recording;
  S.L = timelineLen();
  drawAll();
  placePlayheads();
}

function drawAll() {
  for (const el of document.querySelectorAll('#trackList .track')) {
    const cv = el.querySelector('canvas');
    if (el.dataset.id === 'rec') { if (R) drawWave(cv, R.peaks, T.startPos, cssVar('--red')); continue; }
    const t = S.tracks.find((x) => x.id === el.dataset.id);
    if (t) drawWave(cv, t.peaks, t.start, color(t.color));
  }
}

function drawWave(cv, peaks, start, col) {
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (!w) return;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const L = S.L || timelineLen(), barLen = 4 * beatLen();
  if (barLen / L * w > 8) {
    g.fillStyle = cssVar('--line');
    for (let b = barLen; b < L; b += barLen) g.fillRect(Math.round(b / L * w), 0, 1, h);
  }
  g.fillStyle = col;
  const step = 2;
  for (let x = 0; x < w; x += step) {
    const i0 = Math.floor((x / w * L - start) * PPS), i1 = Math.ceil(((x + step) / w * L - start) * PPS);
    if (i1 <= 0 || i0 >= peaks.length) continue;
    let m = 0;
    for (let i = Math.max(0, i0); i < Math.min(peaks.length, i1); i++) if (peaks[i] > m) m = peaks[i];
    const a = Math.max(1, (m / 255) * (h / 2 - 3));
    g.fillRect(x, h / 2 - a, step - 0.6, a * 2);
  }
}

function placePlayheads() {
  const L = S.L || timelineLen();
  const pct = Math.max(0, Math.min(1, songTime() / L)) * 100;
  for (const ph of document.querySelectorAll('#trackList .ph')) ph.style.left = pct + '%';
}

let lastLiveDraw = 0;
function tick(now) {
  if (S.song && !$('#song').hidden) {
    renderCounter();
    if (S.tab === 'tracks') {
      const L = timelineLen();
      if (L !== S.L) { S.L = L; drawAll(); }
      if (T.recording && now - lastLiveDraw > 66) {
        lastLiveDraw = now;
        const cv = document.querySelector('.track.is-recording canvas');
        if (cv && R) drawWave(cv, R.peaks, T.startPos, cssVar('--red'));
      }
      placePlayheads();
    }
    if (S.tab === 'chords') highlightChord();
    if (R) $('#meterFill').style.width = Math.min(100, R.level * 140) + '%';
  }
  if (T.playing) requestAnimationFrame(tick);
}

function renderCounter() {
  const t = songTime();
  if (T.playing && t < 0) {
    $('#counter').textContent = 'Count ' + Math.ceil(-t / beatLen());
    return;
  }
  $('#counter').textContent = fmtTime(Math.max(0, t));
}

const ICON_PLAY = '<svg viewBox="0 0 24 24"><path d="M7 5v14l12-7z" fill="currentColor"/></svg>';
const ICON_STOP = '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>';
function renderTransport() {
  $('#play').innerHTML = T.playing ? ICON_STOP : ICON_PLAY;
  $('#play').setAttribute('aria-label', T.playing ? 'Stop' : 'Play');
  $('#rec').classList.toggle('on', T.recording);
  $('#rec').setAttribute('aria-label', T.recording ? 'Stop recording' : 'Record');
  $('#metro').setAttribute('aria-pressed', String(metroOn));
  const st = $('#status');
  st.classList.toggle('rec', T.recording);
  st.textContent = T.recording ? 'Recording' : T.playing ? 'Playing' : metroOn ? `Click · ${S.song?.bpm || 90} BPM` : 'Ready';
  renderCounter();
  placePlayheads();
}

// ---------- chords view ----------
function renderChords() {
  const s = S.song, m = MODES[s.mode];
  $('#keyRoot').innerHTML = NOTE.map((n, i) => `<option value="${i}"${i === s.key ? ' selected' : ''}>${n}</option>`).join('');
  $('#keyMode').value = s.mode;
  $('#bpm').value = s.bpm;
  $('#palette').innerHTML = m.steps.map((_, d) => {
    const c = chordNotes(d);
    return `<button class="chord-btn" type="button" data-deg="${d}"><b>${c.name}</b><small>${c.roman}</small></button>`;
  }).join('');
  $('#prog').innerHTML = s.prog.map((d, i) => {
    const c = chordNotes(d);
    return `<button class="prog-chip" type="button" data-i="${i}" aria-label="Remove ${c.name}, bar ${i + 1}"><b>${c.name}</b><small>${i + 1} · ${c.roman}</small></button>`;
  }).join('');
  $('#starters').innerHTML = m.starters.map((p, i) =>
    `<button type="button" data-starter="${i}">${p.map((d) => m.roman[d]).join('–')}</button>`).join('');
  highlightChord();
}

function highlightChord() {
  const chips = document.querySelectorAll('#prog .prog-chip');
  let now = -1;
  if (T.playing && chordsActive()) {
    const t = songTime();
    if (t >= 0) now = Math.floor(t / (4 * beatLen())) % S.song.prog.length;
  }
  chips.forEach((c, i) => c.classList.toggle('now', i === now));
}

// ---------- sheet & toast ----------
function openSheet(html) {
  $('#sheetPanel').innerHTML = html;
  $('#sheet').hidden = false;
}
function closeSheet() { $('#sheet').hidden = true; }
$('#sheet').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(); });

let toastTimer;
function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, ms);
}
function hideToast() { $('#toast').hidden = true; }

function confirmSheet(title, body, label, onYes) {
  openSheet(`<h3>${esc(title)}</h3><p>${esc(body)}</p>
    <div class="sheet-row"><button class="btn ghost" data-close type="button">Cancel</button>
    <button class="btn danger" id="yes" type="button">${esc(label)}</button></div>`);
  $('#yes').onclick = () => { closeSheet(); onYes(); };
}

// ---------- events ----------
$('#quickRec').addEventListener('click', async () => {
  audio(); // unlock audio inside the tap
  const song = newSongObj(ideaTitle());
  await put('songs', song);
  await openSong(song);
  record();
});
$('#newSong').addEventListener('click', async () => {
  const song = newSongObj('Untitled song');
  await put('songs', song);
  await openSong(song);
  $('#songTitle').select();
});
$('#songList').addEventListener('click', async (e) => {
  const b = e.target.closest('.song-item');
  if (!b) return;
  const song = (await getAll('songs')).find((s) => s.id === b.dataset.id);
  if (song) openSong(song);
});
$('#back').addEventListener('click', () => showLibrary());

$('#songTitle').addEventListener('input', (e) => { S.song.title = e.target.value; saveSongSoon(); });
$('#songTitle').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });

document.querySelector('.tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[role=tab]');
  if (b) showTab(b.dataset.tab);
});

$('#play').addEventListener('click', () => (T.playing ? stop() : play()));
$('#rec').addEventListener('click', () => record());
$('#rewind').addEventListener('click', async () => {
  const was = T.playing && !T.recording;
  if (T.recording) return;
  await stop();
  T.pos = 0;
  renderTransport();
  if (was) play();
});
$('#metro').addEventListener('click', () => {
  metroOn = !metroOn;
  pref.set('metro', metroOn);
  renderTransport();
  toast(metroOn ? `Click on, with a 4-beat count-in before recording` : 'Click off');
});

// Track list: mute, options, seek, rename, volume
$('#trackList').addEventListener('click', async (e) => {
  const card = e.target.closest('.track');
  if (!card) return;
  const t = S.tracks.find((x) => x.id === card.dataset.id);
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'mute' && t) {
    t.muted = !t.muted;
    card.classList.toggle('is-muted', t.muted);
    e.target.closest('[data-act]').setAttribute('aria-pressed', String(t.muted));
    saveTrackSoon(t);
    if (T.playing && !T.recording) { await stop(); play(); }
    return;
  }
  if (act === 'more' && t) return trackMenu(t);
  const wave = e.target.closest('.wave');
  if (wave && !T.recording) {
    const rect = wave.getBoundingClientRect();
    const was = T.playing;
    await stop();
    T.pos = Math.max(0, (e.clientX - rect.left) / rect.width * (S.L || timelineLen()));
    renderTransport();
    if (was) play();
  }
});
$('#trackList').addEventListener('input', (e) => {
  const card = e.target.closest('.track');
  const t = card && S.tracks.find((x) => x.id === card.dataset.id);
  if (!t) return;
  if (e.target.classList.contains('tr-name')) { t.name = e.target.value; saveTrackSoon(t); }
  if (e.target.type === 'range') {
    t.volume = Number(e.target.value);
    card.querySelector('output').textContent = Math.round(t.volume * 100);
    saveTrackSoon(t);
  }
});
$('#trackList').addEventListener('change', async (e) => {
  if (e.target.type === 'range' && T.playing && !T.recording) { await stop(); play(); }
});

function trackMenu(t) {
  openSheet(`<h3>${esc(t.name)}</h3><p>${fmtTime(t.duration)} long · starts at ${fmtTime(t.start)}</p>
    <button class="sheet-item" id="shareTake" type="button">Share or save this take</button>
    <button class="sheet-item danger" id="delTake" type="button">Delete this take</button>
    <button class="sheet-item" data-close type="button">Cancel</button>`);
  $('#shareTake').onclick = () => offerFile(t.data, fileName(S.song.title + ' ' + t.name) + '.wav', 'Take ready');
  $('#delTake').onclick = () => confirmSheet('Delete this take?', `“${t.name}” will be gone for good.`, 'Delete', async () => {
    if (T.playing) await stop();
    await del('tracks', t.id);
    buffers.delete(t.id);
    S.tracks = S.tracks.filter((x) => x.id !== t.id);
    await saveSong();
    renderTracks();
    toast('Take deleted');
  });
}

$('#songMenu').addEventListener('click', () => {
  const ms = pref.get('latencyMs', 0);
  openSheet(`<h3>${esc(S.song.title || 'Song')}</h3>
    <button class="sheet-item" id="mixBtn" type="button">Export mix as WAV</button>
    <div class="sheet-item" style="cursor:default">
      <label for="lat">Recording sync</label>
      <p style="font-weight:400;font-size:13px;margin:4px 0 8px">If new takes sound late against older ones, move this right. If they sound early, move it left.</p>
      <div class="range-row"><input id="lat" type="range" min="-100" max="300" step="5" value="${ms}"><output id="latOut">${ms} ms</output></div>
    </div>
    <button class="sheet-item danger" id="delSong" type="button">Delete song</button>
    <button class="sheet-item" data-close type="button">Close</button>`);
  $('#mixBtn').onclick = exportMix;
  $('#lat').oninput = (e) => { pref.set('latencyMs', Number(e.target.value)); $('#latOut').textContent = e.target.value + ' ms'; };
  $('#delSong').onclick = () => confirmSheet('Delete this song?', 'All takes, lyrics and chords in it will be gone for good.', 'Delete song', async () => {
    await stop();
    for (const t of S.tracks) await del('tracks', t.id);
    await del('songs', S.song.id);
    toast('Song deleted');
    showLibrary();
  });
});

// Lyrics
const showSaved = debounced(() => { $('#lyricsSaved').textContent = 'Saved'; }, 700);
$('#lyrics').addEventListener('input', (e) => {
  S.song.lyrics = e.target.value;
  $('#lyricsSaved').textContent = 'Saving…';
  saveSongSoon();
  showSaved();
});
$('#sectionChips').addEventListener('click', (e) => {
  const sec = e.target.closest('[data-sec]')?.dataset.sec;
  if (!sec) return;
  const ta = $('#lyrics'), v = ta.value, at = ta.selectionStart ?? v.length;
  const before = v.slice(0, at), lead = before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
  const ins = `${lead}[${sec}]\n`;
  ta.value = before + ins + v.slice(at);
  ta.focus();
  ta.selectionStart = ta.selectionEnd = at + ins.length;
  ta.dispatchEvent(new Event('input'));
});

// Chords
$('#palette').addEventListener('click', (e) => {
  const b = e.target.closest('[data-deg]');
  if (!b) return;
  const deg = Number(b.dataset.deg), c = audio();
  keysChord(c, master, chordNotes(deg), c.currentTime + 0.02, 1.1);
  S.song.prog.push(deg);
  saveSongSoon();
  renderChords();
});
$('#prog').addEventListener('click', (e) => {
  const b = e.target.closest('[data-i]');
  if (!b) return;
  S.song.prog.splice(Number(b.dataset.i), 1);
  saveSongSoon();
  renderChords();
});
$('#starters').addEventListener('click', (e) => {
  const b = e.target.closest('[data-starter]');
  if (!b) return;
  S.song.prog = [...MODES[S.song.mode].starters[Number(b.dataset.starter)]];
  saveSongSoon();
  renderChords();
});
$('#clearProg').addEventListener('click', () => { S.song.prog = []; saveSongSoon(); renderChords(); });
$('#keyRoot').addEventListener('change', (e) => { S.song.key = Number(e.target.value); saveSongSoon(); renderChords(); });
$('#keyMode').addEventListener('change', (e) => { S.song.mode = e.target.value; saveSongSoon(); renderChords(); });
$('#bpm').addEventListener('change', (e) => {
  const v = Math.round(Number(e.target.value));
  S.song.bpm = Math.min(240, Math.max(40, Number.isFinite(v) && v ? v : 90));
  e.target.value = S.song.bpm;
  saveSongSoon();
  renderTransport();
});

// Band
const INSTRUMENTS = [
  { id: 'drums', title: 'Drums', list: DRUM_PATTERNS, label: 'Beat' },
  { id: 'bass', title: 'Bass', list: BASS_PATTERNS, label: 'Bass line' },
  { id: 'guitar', title: 'Guitar', list: GUITAR_PATTERNS, label: 'Part' },
];
function renderBand() {
  const s = S.song, b = s.band;
  $('#autoTake').innerHTML = S.tracks.length
    ? S.tracks.map((t, i) => `<option value="${t.id}"${i === S.tracks.length - 1 ? ' selected' : ''}>${esc(t.name)} · ${fmtTime(t.duration, false)}</option>`).join('')
    : '<option value="">Record a take first</option>';
  $('#autoBuild').disabled = !S.tracks.length;
  const needChords = !s.prog.length && (b.bass.on || b.guitar.on);
  const card = (inst) => {
    const st = b[inst.id];
    const kit = inst.id === 'drums' ? `
      <div class="seg" role="radiogroup" aria-label="Drum kit">
        ${Object.entries(KIT_NAMES).map(([k, n]) => `<button type="button" role="radio" data-kit="${k}" aria-checked="${st.kit === k}">${n}</button>`).join('')}
      </div>` : '';
    return `
    <article class="inst${st.on ? '' : ' off'}" data-inst="${inst.id}">
      <header><h4>${inst.title}</h4><button class="inst-on" type="button" data-on aria-pressed="${st.on}">${st.on ? 'ON' : 'OFF'}</button></header>
      ${kit}
      <div class="pick">
        <button class="tr-btn" type="button" data-step="-1" aria-label="Previous ${inst.label.toLowerCase()}">‹</button>
        <select id="pat-${inst.id}" aria-label="${inst.label}">${inst.list.map((p, i) => `<option value="${i}"${i === st.pattern ? ' selected' : ''}>${i + 1}. ${p.name}</option>`).join('')}</select>
        <button class="tr-btn" type="button" data-step="1" aria-label="Next ${inst.label.toLowerCase()}">›</button>
      </div>
      <div class="vol-row"><span>Vol</span><input type="range" min="0" max="1.5" step="0.01" value="${st.vol}" id="bvol-${inst.id}" aria-label="${inst.title} volume"><output>${Math.round(st.vol * 100)}</output></div>
    </article>`;
  };
  $('#instruments').innerHTML = INSTRUMENTS.map(card).join('') + `
    <article class="inst${s.chordsInMix ? '' : ' off'}" data-inst="keys">
      <header><h4>Keys</h4><button class="inst-on" type="button" data-on aria-pressed="${s.chordsInMix}">${s.chordsInMix ? 'ON' : 'OFF'}</button></header>
      <p class="inst-hint">A soft chord pad. Plays only when the Chords tab has a progression.</p>
      <div class="vol-row"><span>Vol</span><input type="range" min="0" max="1.5" step="0.01" value="${b.keysVol}" id="bvol-keys" aria-label="Keys volume"><output>${Math.round(b.keysVol * 100)}</output></div>
    </article>` + (needChords ? '<p class="inst-hint">No chords yet, so bass and guitar stay on the home chord. Add chords in the Chords tab, or use Auto band.</p>' : '');
}
function bandChanged() {
  saveSongSoon();
  setBandLevels(T.out, S.song);
  if (!T.playing) return;
  // Keep looping when the band turns on; stop the loop logic when it turns off.
  renderTransport();
}
$('#instruments').addEventListener('click', (e) => {
  const card = e.target.closest('.inst');
  if (!card) return;
  const id = card.dataset.inst, b = S.song.band;
  if (e.target.closest('[data-on]')) {
    if (id === 'keys') S.song.chordsInMix = !S.song.chordsInMix;
    else b[id].on = !b[id].on;
    bandChanged();
    renderBand();
    return;
  }
  const kit = e.target.closest('[data-kit]')?.dataset.kit;
  if (kit) { b.drums.kit = kit; b.drums.on = true; bandChanged(); renderBand(); return; }
  const step = e.target.closest('[data-step]')?.dataset.step;
  if (step) {
    const n = INSTRUMENTS.find((x) => x.id === id).list.length;
    b[id].pattern = (b[id].pattern + Number(step) + n) % n;
    b[id].on = true;
    bandChanged();
    renderBand();
  }
});
$('#instruments').addEventListener('change', (e) => {
  const card = e.target.closest('.inst');
  if (!card || e.target.tagName !== 'SELECT') return;
  const st = S.song.band[card.dataset.inst];
  st.pattern = Number(e.target.value);
  st.on = true;
  bandChanged();
  renderBand();
});
$('#instruments').addEventListener('input', (e) => {
  const card = e.target.closest('.inst');
  if (!card || e.target.type !== 'range') return;
  const v = Number(e.target.value), id = card.dataset.inst;
  if (id === 'keys') S.song.band.keysVol = v; else S.song.band[id].vol = v;
  card.querySelector('output').textContent = Math.round(v * 100);
  bandChanged();
});

$('#autoBuild').addEventListener('click', async () => {
  const t = S.tracks.find((x) => x.id === $('#autoTake').value);
  if (!t) return;
  audio();
  toast('Listening to your take…', 20000);
  await wait(30);
  let fit = null;
  try {
    const buf = await bufferFor(t);
    fit = fitSong(trackPitch(buf, t.start), S.song.bpm);
  } catch {}
  hideToast();
  if (!fit) { toast('No clear melody found. Hum louder, closer to the mic, for at least 4 seconds.', 4500); return; }
  const before = JSON.stringify({ key: S.song.key, mode: S.song.mode, prog: S.song.prog, band: S.song.band, chordsInMix: S.song.chordsInMix });
  if (T.playing) await stop();
  Object.assign(S.song, { key: fit.key, mode: fit.mode, prog: fit.prog, chordsInMix: false });
  const b = S.song.band;
  b.drums.on = b.bass.on = b.guitar.on = true;
  saveSongSoon();
  renderChords();
  renderBand();
  openSheet(`<h3>Your band is ready</h3>
    <p>Key: <strong>${fit.name}</strong> · ${fit.prog.length} ${fit.prog.length === 1 ? 'bar' : 'bars'} at ${S.song.bpm} BPM</p>
    <p style="font-family:var(--mono);font-size:13px">${fit.chordNames.map(esc).join(' · ')}</p>
    <p>Press play to hear it with your take. Change beats, parts and chords any time.</p>
    <div class="sheet-row"><button class="btn ghost" id="undoBand" type="button">Undo</button>
    <button class="btn primary" id="playBand" type="button">Play</button></div>`);
  $('#undoBand').onclick = () => {
    Object.assign(S.song, JSON.parse(before));
    saveSongSoon();
    renderChords();
    renderBand();
    closeSheet();
    toast('Band changes undone');
  };
  $('#playBand').onclick = () => { closeSheet(); T.pos = 0; play(); };
});

// Keep the take if the app goes to the background mid-recording.
document.addEventListener('visibilitychange', () => { if (document.hidden && T.recording) stop(); });
window.addEventListener('resize', debounced(() => { if (S.song && S.tab === 'tracks') drawAll(); }, 150));
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (S.song) renderTracks(); });

// Install hint for iPhone users who opened Takes in Safari.
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
if (!standalone && /iphone|ipad|ipod/i.test(navigator.userAgent) && !pref.get('hintDone', false)) $('#installHint').hidden = false;
$('#hideHint').addEventListener('click', () => { pref.set('hintDone', true); $('#installHint').hidden = true; });

// Updates: check on every launch and when the app comes back to the front,
// then reload into the new version unless a take is playing or recording.
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  }).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    if (T.playing || T.recording) { toast('Takes was updated. Close and reopen it to use the new version.', 5000); return; }
    reloading = true;
    location.reload();
  });
}

showLibrary().catch(() => toast('Storage is not available. Private browsing can block it.'));
