// TD版の mio（Python）と描画ネットワークを、Canvas 2D と Web Audio に置き換えたもの

// ---- 設定（TD版と同じ値）----
const params = new URLSearchParams(location.search);
const DELAY = Number(params.get('delay')) || 509.0;   // 旅の秒数。?delay=30 で短くできる
const SCALE = [0, 2, 4, 7, 9];   // ド レ ミ ソ ラ
const BASE = 60;                 // 一番低い音の番号（中央のド）
const STEPS = 10;                // 横方向の分割数
const GLOW_DIM = 0.25;           // 十字のふだんの明るさ
const RIP_TIME = 1.5;            // 到着の輪が広がって消えるまでの秒数
const RIP_FROM = 0.02;
const RIP_TO = 0.12;
const TOUCH_TOP = 1;             // 反応する範囲の上端（1 = 全面）
const TAP_TIME = 0.6;            // 触れた位置の輪が消えるまでの秒数
const HOT_LAYERS = 2;
const LABEL_FADE = 3.0;
const LABEL_END = 5.0;
const LABEL_HOLD = 0.05;
const SAVE_KEY = 'mio_events';   // TD版の mio_events.txt の代わり

// ---- 描画の基準 ----
const SIZE = 1080;               // TD版の解像度
const FONT = 'Helvetica, Arial, sans-serif';
const D = window.MIO_DATA;
const PATH = D.path;             // みおの航跡（1日1点）
const FLYBY_P = D.flybys.map(f => f.p);

const canvas = document.getElementById('view');
const ctx = canvas.getContext('2d');
const layer = document.createElement('canvas');   // TD版の Render TOP にあたる層
const lctx = layer.getContext('2d');

const sky = new Image();
sky.src = 'assets/sky_milkyway_bright.png';
const planets = new Image();
planets.src = 'assets/planets_overlay_v4.png';

let scale = 1;

function resize() {
  scale = Math.min(window.devicePixelRatio || 1, 2);
  for (const c of [canvas, layer]) {
    c.width = c.height = SIZE * scale;
  }
}

// TD版の座標（中心が0、端が±1、上が+）を Canvas のピクセルに直す
const px = x => SIZE / 2 + x * SIZE / 2;
const py = y => SIZE / 2 - y * SIZE / 2;
const gray = b => {
  const v = Math.round(Math.min(Math.max(b, 0), 1) * 255);
  return `rgb(${v},${v},${v})`;
};

// ---- 状態 ----
let events = [];                 // [送信時刻(秒), 音の番号, 角度]
let glow = FLYBY_P.map(() => 0);
let last = 0;
let rip = [];
let tap = [];

function now() {
  return Date.now() / 1000;
}

function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(events));
  } catch (e) {
    // 保存できない環境（プライベートブラウズなど）では、その場限りで動かす
  }
}

function restore() {
  let saved = [];
  try {
    saved = JSON.parse(localStorage.getItem(SAVE_KEY)) || [];
  } catch (e) {
    saved = [];
  }
  const t = now();
  // 閉じている間に到着時刻を過ぎた信号は、読み戻さない
  events = saved.filter(e => Array.isArray(e) && e.length === 3 && t - e[0] < DELAY);
}

// ---- 音 ----
let audio = null;
let master = null;

function startAudio() {
  if (!audio) {
    audio = new AudioContext();
    master = audio.createGain();
    master.gain.value = 0.2;     // TD版の mix（gain 0.2）
    master.connect(audio.destination);
  }
  if (audio.state === 'suspended') audio.resume();
}

// TD版の voice（Audio Oscillator × Trigger: アタック0.02秒、ディケイ0.8秒）
function play(note) {
  if (!audio || audio.state !== 'running') return;
  const t = audio.currentTime;
  const osc = audio.createOscillator();
  const env = audio.createGain();
  osc.frequency.value = 440 * 2 ** ((note - 69) / 12);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(1, t + 0.02);
  env.gain.linearRampToValueAtTime(0, t + 0.82);
  osc.connect(env).connect(master);
  osc.start(t);
  osc.stop(t + 0.85);
}

// ---- 送信 ----
function send(u, v) {
  if (v > TOUCH_TOP) return;
  tap.push([now(), u * 2 - 1, v * 2 - 1]);

  const step = Math.min(Math.floor(u * STEPS), STEPS - 1);
  const note = BASE + 12 * Math.floor(step / 5) + SCALE[step % 5];
  const angle = (200 + 140 * u) * Math.PI / 180;

  events.push([now(), note, angle]);
  save();
  play(note);
}

canvas.addEventListener('pointerdown', e => {
  e.preventDefault();
  startAudio();
  const r = canvas.getBoundingClientRect();
  const u = (e.clientX - r.left) / r.width;
  const v = 1 - (e.clientY - r.top) / r.height;
  if (u < 0 || u > 1 || v < 0 || v > 1) return;
  send(u, v);
});

// ---- 計算（TD版の path, label_hot, update と同じ）----
function path(p, note) {
  const f = p * (PATH.length - 1);
  const i = Math.floor(f);
  const j = Math.min(i + 1, PATH.length - 1);
  const k = f - i;
  let x = PATH[i][0] + (PATH[j][0] - PATH[i][0]) * k;
  let y = PATH[i][1] + (PATH[j][1] - PATH[i][1]) * k;
  // 音の高さに応じて、軌道の内外へわずかにずらす（和音が重ならないように）
  const d = Math.hypot(x, y);
  if (d > 0.02) {
    const off = (note - 70) * 0.0015;
    x += x / d * off;
    y += y / d * off;
  }
  return [x, y];
}

function labelHot(age) {
  const hold = DELAY * LABEL_HOLD;
  let h = age < hold ? 1 : Math.max(0, 1 - (age - hold) / LABEL_FADE);
  for (const pf of FLYBY_P) {
    const since = age - pf * DELAY;
    if (since >= 0) h = Math.max(h, 1 - since / LABEL_FADE);
  }
  const left = DELAY - age;
  if (left < LABEL_END) h = Math.max(h, 1 - left / LABEL_END);
  return h;
}

const pad = n => String(n).padStart(2, '0');

function update() {
  const t = now();
  const dt = last ? t - last : 0;
  last = t;
  let changed = false;

  // 光っている十字を少しずつ暗くする（TD版は60fpsで毎フレーム0.92倍）
  const fade = Math.pow(0.92, dt * 60);
  glow = glow.map(g => g * fade);

  const particles = [];
  const labels = [];

  for (let r = events.length - 1; r >= 0; r--) {
    const [t0, note] = events[r];
    const p = (t - t0) / DELAY;

    if (p >= 1) {
      // 到着。タブが裏にあって大きく遅れた到着は、音を鳴らさない
      if ((p - 1) * DELAY < 1) play(note);
      rip.push(t);
      events.splice(r, 1);
      changed = true;
      continue;
    }

    const prev = p - dt / DELAY;
    FLYBY_P.forEach((pf, i) => {
      if (prev < pf && pf <= p) glow[i] = 1;
    });

    const [x, y] = path(p, note);
    particles.push([x, y]);

    // 和音は文字を1つにまとめる
    if (r > 0 && t0 - events[r - 1][0] < 0.3) continue;

    const sent = new Date(t0 * 1000);
    const e = Math.floor(t - t0);
    const text = `TX ${pad(sent.getHours())}:${pad(sent.getMinutes())}:${pad(sent.getSeconds())}  +${pad(Math.floor(e / 60))}:${pad(e % 60)}`;
    const hot = Math.round(labelHot(t - t0) * HOT_LAYERS);
    labels.push([text, x, y, hot]);
  }

  rip = rip.filter(t0 => t - t0 < RIP_TIME);
  tap = tap.filter(a => t - a[0] < TAP_TIME);
  if (changed) save();

  return { t, particles, labels };
}

// ---- 描画 ----
function polyline(c, pts) {
  c.beginPath();
  pts.forEach(([x, y], i) => (i ? c.lineTo(px(x), py(y)) : c.moveTo(px(x), py(y))));
  c.stroke();
}

function ring(c, x, y, r, b) {
  c.strokeStyle = gray(b);
  c.beginPath();
  c.arc(px(x), py(y), r * SIZE / 2, 0, Math.PI * 2);
  c.stroke();
}

// TD版の render1（正投影の線・円）
function drawLayer(state) {
  const c = lctx;
  c.setTransform(scale, 0, 0, scale, 0, 0);
  c.globalCompositeOperation = 'source-over';
  c.fillStyle = '#000';
  c.fillRect(0, 0, SIZE, SIZE);
  c.lineWidth = 1;

  // geo4: 惑星の軌道（青）
  c.strokeStyle = 'rgb(0,0,255)';
  D.orbits.forEach(o => polyline(c, o));

  // geo2: みおの航跡（灰）
  c.strokeStyle = gray(0.25);
  polyline(c, PATH);

  // geo3: 目印の輪
  D.markers.forEach(m => ring(c, m.tx, m.ty, m.s, 1));

  // geo5: スイングバイ地点の十字
  D.flybys.forEach((f, i) => {
    const s = f.s * SIZE / 2;
    c.strokeStyle = gray(GLOW_DIM + (1 - GLOW_DIM) * glow[i]);
    c.beginPath();
    c.moveTo(px(f.tx) - s, py(f.ty));
    c.lineTo(px(f.tx) + s, py(f.ty));
    c.moveTo(px(f.tx), py(f.ty) - s);
    c.lineTo(px(f.tx), py(f.ty) + s);
    c.stroke();
  });

  // geo_arrive: 到着の輪（最初は速く、だんだんゆっくり広がる）
  const [ax, ay] = PATH[PATH.length - 1];
  rip.forEach(t0 => {
    const k = (state.t - t0) / RIP_TIME;
    const grow = 1 - (1 - k) ** 2;
    ring(c, ax, ay, RIP_FROM + (RIP_TO - RIP_FROM) * grow, 1 - k);
  });

  // geo7, geo6: 触れた位置の輪と、地球へ向かう線
  const [ex, ey] = PATH[0];
  tap.forEach(([t0, x, y]) => {
    const k = (state.t - t0) / TAP_TIME;
    ring(c, x, y, 0.015 + 0.02 * k, 1 - k);
    c.strokeStyle = gray(0.6 * (1 - k));
    c.beginPath();
    c.moveTo(px(x), py(y));
    c.lineTo(px(ex), py(ey));
    c.stroke();
  });

  // geo1: 旅の途中の粒子
  c.fillStyle = '#fff';
  state.particles.forEach(([x, y]) => {
    c.beginPath();
    c.arc(px(x), py(y), 0.01 * SIZE / 2, 0, Math.PI * 2);
    c.fill();
  });
}

function draw(state) {
  drawLayer(state);

  const c = ctx;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = 'source-over';
  c.fillStyle = '#000';
  c.fillRect(0, 0, canvas.width, canvas.height);
  c.setTransform(scale, 0, 0, scale, 0, 0);

  // comp1（加算）: 星空 + 線の層 + 文字
  if (sky.complete) c.drawImage(sky, 0, 0, SIZE, SIZE);
  c.globalCompositeOperation = 'lighter';
  c.drawImage(layer, 0, 0, SIZE, SIZE);

  // 粒子のラベル（ふだんは明るさ0.3、節目で明るい文字が重なり最大0.5）
  c.font = `11px ${FONT}`;
  c.textAlign = 'left';
  c.textBaseline = 'alphabetic';
  state.labels.forEach(([text, x, y, hot]) => {
    c.fillStyle = gray(0.3 + 0.1 * hot);
    c.fillText(text, Math.round(px(x)), Math.round(py(y)) - 14);
  });

  // text1〜3: 天体の表記（位置は画面の中心からのピクセル数）
  c.font = `17px ${FONT}`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillStyle = gray(0.6);
  [['SUN', 30, 15], ['EARTH 2018-10-20  TX', 140, -417], ['MIO / MERCURY 2026-11-21  RX', 285, 83]]
    .forEach(([text, x, y]) => c.fillText(text, SIZE / 2 + x, SIZE / 2 - y));

  // over1: 太陽・地球・水星の画像を一番上に重ねる
  c.globalCompositeOperation = 'source-over';
  if (planets.complete) c.drawImage(planets, 0, 0, SIZE, SIZE);
}

function frame() {
  draw(update());
  requestAnimationFrame(frame);
}

resize();
window.addEventListener('resize', resize);
restore();
requestAnimationFrame(frame);
