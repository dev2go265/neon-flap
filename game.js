// Neon Flap — Flappy-style arcade game. Plain canvas JS, no assets.
// Win: clear 20 pipes. Lose: hit a pipe or the ground.
// Controls: Space / click / tap / Arrow Up to flap, P pause, M mute.
'use strict';

const W = 480, H = 720, GROUND_H = 80, WIN_SCORE = 20;
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const hudScore = document.getElementById('hud-score');
const hudBest = document.getElementById('hud-best');
const muteBtn = document.getElementById('mute-btn');
const panelTitle = document.getElementById('panel-title');
const panelOver = document.getElementById('panel-over');
const panelPause = document.getElementById('panel-pause');
const overTitle = document.getElementById('over-title');
const overText = document.getElementById('over-text');
const overScore = document.getElementById('over-score');
const overBest = document.getElementById('over-best');

let state = 'title'; // title | playing | paused | over | win
let score = 0;
let best = 0;
try { best = parseInt(localStorage.getItem('neonFlapBest') || '0', 10) || 0; } catch (e) { best = 0; }
let muted = false;
try { muted = localStorage.getItem('neonFlapMuted') === '1'; } catch (e) { muted = false; }

let speedMult = 1.0, gravityMult = 1.0, flapMult = 1.0;
const BASE_GRAVITY = 0.45, BASE_FLAP = -8.4, BASE_SPEED = 2.4;
const PIPE_W = 72, PIPE_GAP = 172, PIPE_SPACING = 265;

const bird = { x: 120, y: H / 2, vy: 0, r: 16, wing: 0 };
let pipes = [];
let particles = [];
let popups = [];
let stars = [];
let frame = 0, lastTs = 0, overAt = 0, shake = 0;

for (let i = 0; i < 90; i++) {
  stars.push({ x: Math.random() * W, y: Math.random() * (H - GROUND_H), s: Math.random() * 2 + 0.5, tw: Math.random() * Math.PI * 2 });
}

// ---------- audio ----------
let audioCtx = null;
function beep(freq, dur, type, vol, slideTo) {
  if (muted) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, audioCtx.currentTime);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, audioCtx.currentTime + dur);
    g.gain.setValueAtTime(vol || 0.08, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + dur);
  } catch (e) { /* audio unavailable — game still works */ }
}
const sfxFlap = () => beep(520, 0.09, 'square', 0.06, 760);
const sfxScore = () => { beep(880, 0.08, 'sine', 0.09); setTimeout(() => beep(1320, 0.12, 'sine', 0.09), 70); };
const sfxHit = () => beep(160, 0.3, 'sawtooth', 0.12, 50);
const sfxWin = () => { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.18, 'sine', 0.1), i * 120)); };

// ---------- settings ----------
function bindSlider(id, valId, fmt, apply) {
  const el = document.getElementById(id), lab = document.getElementById(valId);
  if (!el || !lab) return;
  const update = () => { const v = parseFloat(el.value); lab.textContent = fmt(v); apply(v); };
  el.addEventListener('input', update);
  update();
}
bindSlider('speed-slider', 'speed-val', v => v.toFixed(1) + '×', v => { speedMult = v; });
bindSlider('gravity-slider', 'gravity-val', v => v.toFixed(1) + '×', v => { gravityMult = v; });
bindSlider('flap-slider', 'flap-val', v => v.toFixed(1) + '×', v => { flapMult = v; });

function setMuted(m) {
  muted = m;
  muteBtn.textContent = muted ? '🔇 Muted' : '🔊 Sound';
  try { localStorage.setItem('neonFlapMuted', muted ? '1' : '0'); } catch (e) {}
}
setMuted(muted);
muteBtn.addEventListener('click', () => setMuted(!muted));

// ---------- sizing ----------
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('resize', resize);
resize();

// ---------- game flow ----------
function showPanel(which) {
  panelTitle.classList.toggle('hidden', which !== 'title');
  panelOver.classList.toggle('hidden', which !== 'over');
  panelPause.classList.toggle('hidden', which !== 'pause');
}
function updateHud() {
  hudScore.textContent = String(score);
  hudBest.textContent = String(best);
}
function reset() {
  score = 0;
  pipes = [];
  particles = [];
  popups = [];
  bird.y = H / 2; bird.vy = 0; bird.wing = 0;
  shake = 0;
  spawnPipe(W + 80);
  updateHud();
}
function start() {
  reset();
  state = 'playing';
  showPanel(null);
  sfxFlap();
}
function endGame(won, reason) {
  state = won ? 'win' : 'over';
  overAt = performance.now();
  if (score > best) {
    best = score;
    try { localStorage.setItem('neonFlapBest', String(best)); } catch (e) {}
  }
  updateHud();
  overTitle.textContent = won ? 'YOU WIN!' : 'GAME OVER';
  overText.textContent = won
    ? 'You cleared all 20 pipes. Neon legend!'
    : (reason || 'You hit a pipe!');
  overScore.textContent = String(score);
  overBest.textContent = String(best);
  showPanel('over');
  if (won) sfxWin(); else { sfxHit(); burst(bird.x, bird.y, '#ff2fd6', 26); shake = 14; }
}
function togglePause() {
  if (state === 'playing') { state = 'paused'; showPanel('pause'); }
  else if (state === 'paused') { state = 'playing'; showPanel(null); }
}
function flap() {
  if (state === 'playing') {
    bird.vy = BASE_FLAP * flapMult;
    bird.wing = 1;
    sfxFlap();
    spawnTrail();
  }
}
function spawnPipe(x) {
  const minY = 120, maxY = H - GROUND_H - 120;
  const gapY = minY + Math.random() * (maxY - minY);
  pipes.push({ x: x, gapY: gapY, gapH: PIPE_GAP, scored: false });
}
function burst(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 4;
    particles.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 30 + Math.random() * 20, color: color, size: 2 + Math.random() * 3 });
  }
}
function spawnTrail() {
  particles.push({ x: bird.x - bird.r, y: bird.y + 4, vx: -1.5, vy: 0.4, life: 18, color: '#39ffeb', size: 2.5 });
}

// ---------- update ----------
function update(dt) {
  frame++;
  for (const s of stars) s.tw += 0.05 * dt;
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 0.05 * dt; p.life -= dt;
    if (p.life <= 0) particles.splice(i, 1);
  }
  for (let i = popups.length - 1; i >= 0; i--) {
    popups[i].y -= 0.8 * dt; popups[i].life -= dt;
    if (popups[i].life <= 0) popups.splice(i, 1);
  }
  if (state === 'title') {
    bird.y = H / 2 + Math.sin(frame * 0.05) * 24;
    bird.wing = Math.sin(frame * 0.3) * 0.5 + 0.5;
    movePipes(dt, 1.2);
    return;
  }
  if (state !== 'playing') return;

  bird.vy += BASE_GRAVITY * gravityMult * dt;
  if (bird.vy > 13) bird.vy = 13;
  bird.y += bird.vy * dt;
  bird.wing = Math.max(0, bird.wing - 0.08 * dt);
  if (frame % 4 === 0) spawnTrail();

  // ceiling is safe: bounce softly
  if (bird.y < bird.r) { bird.y = bird.r; bird.vy = Math.max(bird.vy, 0); }

  movePipes(dt, BASE_SPEED * speedMult + Math.min(score * 0.03, 0.6));

  // ground
  if (bird.y + bird.r >= H - GROUND_H) {
    bird.y = H - GROUND_H - bird.r;
    endGame(false, 'You hit the ground!');
    return;
  }
  // pipes
  for (const p of pipes) {
    const hitX = bird.x + bird.r > p.x && bird.x - bird.r < p.x + PIPE_W;
    if (hitX) {
      const topBottom = p.gapY - p.gapH / 2, botTop = p.gapY + p.gapH / 2;
      if (bird.y - bird.r < topBottom || bird.y + bird.r > botTop) {
        endGame(false, 'You hit a pipe!');
        return;
      }
    }
    if (!p.scored && p.x + PIPE_W < bird.x) {
      p.scored = true;
      score++;
      updateHud();
      sfxScore();
      popups.push({ x: bird.x + 20, y: bird.y - 24, text: '+1', life: 40 });
      burst(bird.x + 14, bird.y, '#ffe14d', 10);
      if (score >= WIN_SCORE) { endGame(true); return; }
    }
  }
}
function movePipes(dt, speed) {
  for (let i = pipes.length - 1; i >= 0; i--) {
    pipes[i].x -= speed * dt;
    if (pipes[i].x + PIPE_W < -20) pipes.splice(i, 1);
  }
  if (pipes.length === 0 || pipes[pipes.length - 1].x < W - PIPE_SPACING) spawnPipe(W + 40);
}

// ---------- draw ----------
function draw() {
  ctx.save();
  if (shake > 0) { ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake); shake *= 0.88; if (shake < 0.5) shake = 0; }

  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0a0a2e'); bg.addColorStop(0.6, '#12083a'); bg.addColorStop(1, '#1a0b2e');
  ctx.fillStyle = bg; ctx.fillRect(-20, -20, W + 40, H + 40);

  // stars
  for (const s of stars) {
    ctx.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(s.tw));
    ctx.fillStyle = '#bfefff';
    ctx.fillRect(s.x, s.y, s.s, s.s);
  }
  ctx.globalAlpha = 1;

  // skyline
  ctx.fillStyle = '#0d0d28';
  const skyline = [60, 110, 80, 130, 95, 70, 120, 85];
  let sx = -10;
  for (const h of skyline) { ctx.fillRect(sx, H - GROUND_H - h, 66, h); sx += 66; }
  ctx.fillStyle = '#ffe14d';
  for (let i = 0; i < 24; i++) {
    const wx = (i * 67) % W, wy = H - GROUND_H - 30 - ((i * 53) % 120);
    ctx.globalAlpha = 0.5;
    ctx.fillRect(wx, wy, 4, 5);
  }
  ctx.globalAlpha = 1;

  // pipes
  for (const p of pipes) drawPipe(p);

  // ground
  ctx.fillStyle = '#0a0a20';
  ctx.fillRect(-20, H - GROUND_H, W + 40, GROUND_H);
  ctx.fillStyle = '#39ffeb';
  ctx.shadowColor = '#39ffeb'; ctx.shadowBlur = 14;
  ctx.fillRect(-20, H - GROUND_H, W + 40, 4);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ff2fd6';
  for (let x = 0; x < W; x += 48) ctx.fillRect(x + ((frame * 2) % 48), H - GROUND_H + 34, 22, 4);

  // bird
  drawBird();

  // particles
  for (const pt of particles) {
    ctx.globalAlpha = Math.max(0, pt.life / 40);
    ctx.fillStyle = pt.color;
    ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // score popups
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'center';
  for (const pp of popups) {
    ctx.globalAlpha = Math.max(0, pp.life / 40);
    ctx.fillStyle = '#ffe14d';
    ctx.fillText(pp.text, pp.x, pp.y);
  }
  ctx.globalAlpha = 1;

  // big score
  if (state === 'playing' || state === 'paused') {
    ctx.font = 'bold 52px sans-serif';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#39ffeb'; ctx.shadowBlur = 18;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(score), W / 2, 78);
    ctx.shadowBlur = 0;
    ctx.font = '16px sans-serif';
    ctx.fillStyle = '#bfefff';
    ctx.fillText('of ' + WIN_SCORE + ' pipes', W / 2, 104);
  }
  ctx.restore();
}
function drawPipe(p) {
  const topH = p.gapY - p.gapH / 2, botY = p.gapY + p.gapH / 2;
  ctx.save();
  ctx.shadowColor = '#2bff5e'; ctx.shadowBlur = 16;
  ctx.fillStyle = '#0f3d1e';
  ctx.strokeStyle = '#2bff5e'; ctx.lineWidth = 3;
  // top pipe
  ctx.fillRect(p.x, -4, PIPE_W, topH + 4);
  ctx.strokeRect(p.x, -4, PIPE_W, topH + 4);
  // bottom pipe
  ctx.fillRect(p.x, botY, PIPE_W, H - GROUND_H - botY + 4);
  ctx.strokeRect(p.x, botY, PIPE_W, H - GROUND_H - botY + 4);
  // glowing rims at the gap
  ctx.fillStyle = '#2bff5e';
  ctx.fillRect(p.x - 3, topH - 12, PIPE_W + 6, 12);
  ctx.fillRect(p.x - 3, botY, PIPE_W + 6, 12);
  ctx.restore();
  // inner highlight
  ctx.fillStyle = 'rgba(43,255,94,0.25)';
  ctx.fillRect(p.x + 8, 0, 10, topH);
  ctx.fillRect(p.x + 8, botY, 10, H - GROUND_H - botY);
}
function drawBird() {
  ctx.save();
  ctx.translate(bird.x, bird.y);
  const tilt = Math.max(-0.45, Math.min(0.55, bird.vy * 0.045));
  ctx.rotate(tilt);
  ctx.shadowColor = '#ff2fd6'; ctx.shadowBlur = 20;
  // body
  const grad = ctx.createLinearGradient(-16, -16, 16, 16);
  grad.addColorStop(0, '#ff7ae8'); grad.addColorStop(1, '#ff2fd6');
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(0, 0, bird.r, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  // wing
  ctx.fillStyle = '#ffe14d';
  const flap = bird.wing * 8;
  ctx.beginPath();
  ctx.ellipse(-6, 2 + flap * 0.4, 11, 6 - flap * 0.35, -0.4, 0, Math.PI * 2);
  ctx.fill();
  // eye
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(7, -6, 5.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#050510';
  ctx.beginPath(); ctx.arc(9, -6, 2.6, 0, Math.PI * 2); ctx.fill();
  // beak
  ctx.fillStyle = '#ff9d00';
  ctx.beginPath();
  ctx.moveTo(14, -2); ctx.lineTo(24, 1); ctx.lineTo(14, 5); ctx.closePath(); ctx.fill();
  ctx.restore();
}

// ---------- loop ----------
function loop(ts) {
  requestAnimationFrame(loop);
  const dt = Math.min((ts - lastTs) / 16.667 || 1, 2.5);
  lastTs = ts;
  update(dt);
  draw();
}
updateHud();
showPanel('title');
requestAnimationFrame(loop);

// ---------- input ----------
function primaryAction() {
  if (state === 'title') start();
  else if (state === 'playing') flap();
  else if (state === 'paused') togglePause();
  else if ((state === 'over' || state === 'win') && performance.now() - overAt > 600) start();
}
document.getElementById('start-btn').addEventListener('click', (e) => { e.stopPropagation(); start(); });
document.getElementById('restart-btn').addEventListener('click', (e) => { e.stopPropagation(); start(); });
document.getElementById('resume-btn').addEventListener('click', (e) => { e.stopPropagation(); togglePause(); });
canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); primaryAction(); });
window.addEventListener('keydown', (e) => {
  if (e.key === ' ' || e.key === 'ArrowUp') { e.preventDefault(); primaryAction(); }
  else if (e.key === 'p' || e.key === 'P') togglePause();
  else if (e.key === 'm' || e.key === 'M') setMuted(!muted);
  else if (e.key === 'Enter' && (state === 'title' || state === 'over' || state === 'win')) start();
});

// Headless-test hook (harmless in the browser).
if (typeof window !== 'undefined') {
  window.__game = {
    bird: bird,
    get pipes() { return pipes; },
    get state() { return state; },
    get score() { return score; },
    get best() { return best; },
    start: start, flap: flap, togglePause: togglePause,
    setMuted: setMuted
  };
}
