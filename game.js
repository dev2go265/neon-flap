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
let flash = 0, hillOff = 0, cityOff = 0;
// Auto-lower effects on small screens so phones hold 60fps.
const LOW_FX = (typeof window !== 'undefined' && (window.innerWidth || 800)) < 480;
const FX = LOW_FX ? 0.5 : 1;          // particle count multiplier
const GLOW = (v) => LOW_FX ? v * 0.5 : v; // shadowBlur scaler
const clouds = [];
for (let i = 0; i < 6; i++) clouds.push({ x: Math.random() * W, y: 60 + Math.random() * 180, s: 30 + Math.random() * 50, sp: 0.15 + Math.random() * 0.25 });
const CITY = [60, 110, 80, 130, 95, 70, 120, 85];
const CITY_W = 66, CITY_TILE = CITY.length * CITY_W;

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
  if (won) sfxWin(); else { sfxHit(); burst(bird.x, bird.y, '#ff2fd6', 16); burst(bird.x, bird.y, '#ffe14d', 14, true); shake = 14; }
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
function burst(x, y, color, n, feathers) {
  const count = Math.max(2, Math.round(n * FX));
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 4;
    const p = { x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 30 + Math.random() * 20, color: color, size: 2 + Math.random() * 3 };
    if (feathers) {
      p.kind = 'feather';
      p.color = ['#ff2fd6', '#ffe14d', '#ffffff', '#39ffeb'][i % 4];
      p.rot = Math.random() * Math.PI * 2;
      p.vr = (Math.random() - 0.5) * 0.3;
      p.size = 5 + Math.random() * 5;
      p.life = 45 + Math.random() * 25;
    }
    particles.push(p);
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
    if (p.kind === 'feather') { p.rot += p.vr * dt; p.vy = Math.min(p.vy, 1.2); p.vx *= 0.99; }
    if (p.life <= 0) particles.splice(i, 1);
  }
  for (let i = popups.length - 1; i >= 0; i--) {
    popups[i].y -= 0.8 * dt; popups[i].life -= dt;
    if (popups[i].life <= 0) popups.splice(i, 1);
  }
  // Parallax scroll: hills 0.3x, city 0.7x, clouds drift on their own.
  const scrollSpeed = state === 'playing' ? (BASE_SPEED * speedMult + Math.min(score * 0.03, 0.6)) : (state === 'title' ? 1.2 : 0);
  hillOff = (hillOff + scrollSpeed * 0.3 * dt) % 480;
  cityOff = (cityOff + scrollSpeed * 0.7 * dt) % CITY_TILE;
  for (const c of clouds) { c.x -= c.sp * dt; if (c.x < -130) { c.x = W + 130; c.y = 60 + Math.random() * 180; } }
  if (flash > 0) flash = Math.max(0, flash - 0.03 * dt);
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
      flash = 1;
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

  // Neon sunset sky
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#070718');
  bg.addColorStop(0.35, '#1a0b3d');
  bg.addColorStop(0.62, '#4a1158');
  bg.addColorStop(0.8, '#a12a5e');
  bg.addColorStop(0.92, '#ff6a3d');
  ctx.fillStyle = bg; ctx.fillRect(-20, -20, W + 40, H + 40);

  // Retro sun with scanline stripes
  const sunX = W * 0.68, sunY = H - GROUND_H - 170, sunR = 92;
  const sunGlow = ctx.createRadialGradient(sunX, sunY, sunR * 0.2, sunX, sunY, sunR * 2.1);
  sunGlow.addColorStop(0, 'rgba(255,150,60,0.55)');
  sunGlow.addColorStop(0.5, 'rgba(255,80,120,0.18)');
  sunGlow.addColorStop(1, 'rgba(255,80,120,0)');
  ctx.fillStyle = sunGlow;
  ctx.fillRect(sunX - sunR * 2.1, sunY - sunR * 2.1, sunR * 4.2, sunR * 4.2);
  ctx.save();
  ctx.beginPath(); ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2); ctx.clip();
  const sunGrad = ctx.createLinearGradient(0, sunY - sunR, 0, sunY + sunR);
  sunGrad.addColorStop(0, '#ffe14d'); sunGrad.addColorStop(0.55, '#ff9d3d'); sunGrad.addColorStop(1, '#ff2f7a');
  ctx.fillStyle = sunGrad;
  ctx.fillRect(sunX - sunR, sunY - sunR, sunR * 2, sunR * 2);
  ctx.fillStyle = 'rgba(26,11,61,0.85)';
  let stripeY = sunY + 8, stripeH = 3;
  while (stripeY < sunY + sunR) { ctx.fillRect(sunX - sunR, stripeY, sunR * 2, stripeH); stripeY += stripeH + 12; stripeH += 2.5; }
  ctx.restore();

  // stars (only in the dark upper sky)
  for (const s of stars) {
    if (s.y > H * 0.45) continue;
    ctx.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(s.tw));
    ctx.fillStyle = '#bfefff';
    ctx.fillRect(s.x, s.y, s.s, s.s);
  }
  ctx.globalAlpha = 1;

  // Drifting neon clouds
  for (const c of clouds) {
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = '#ff9de2';
    ctx.shadowColor = '#ff9de2'; ctx.shadowBlur = GLOW(18);
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, c.s, c.s * 0.32, 0, 0, Math.PI * 2);
    ctx.ellipse(c.x + c.s * 0.5, c.y + 5, c.s * 0.6, c.s * 0.26, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;

  // Distant hills ridge (0.3x parallax)
  ctx.fillStyle = '#1c0d3f';
  ctx.beginPath();
  ctx.moveTo(-20, H - GROUND_H + 2);
  for (let x = -20; x <= W + 20; x += 12) {
    const wx = x + hillOff;
    ctx.lineTo(x, H - GROUND_H - 34 - (Math.sin(wx * 0.021) * 16 + Math.sin(wx * 0.008 + 2) * 24));
  }
  ctx.lineTo(W + 20, H - GROUND_H + 2);
  ctx.closePath(); ctx.fill();
  // Ridge glow line
  ctx.strokeStyle = 'rgba(255,47,214,0.35)'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let x = -20; x <= W + 20; x += 12) {
    const wx = x + hillOff;
    const y = H - GROUND_H - 34 - (Math.sin(wx * 0.021) * 16 + Math.sin(wx * 0.008 + 2) * 24);
    if (x === -20) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Near skyline (0.7x parallax, wraps on a tile)
  for (let tile = 0; tile < 2; tile++) {
    const baseX = -cityOff + tile * CITY_TILE;
    for (let i = 0; i < CITY.length; i++) {
      const bx = baseX + i * CITY_W, bh = CITY[i];
      ctx.fillStyle = '#0d0d28';
      ctx.fillRect(bx, H - GROUND_H - bh, CITY_W - 4, bh);
      ctx.fillStyle = '#ffe14d';
      for (let r = 0; r < 3; r++) {
        for (let col = 0; col < 2; col++) {
          if ((i * 7 + r * 3 + col) % 3 === 0) continue;
          ctx.globalAlpha = 0.55;
          ctx.fillRect(bx + 10 + col * 26, H - GROUND_H - bh + 14 + r * 26, 5, 6);
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  // pipes
  for (const p of pipes) drawPipe(p);

  // ground
  ctx.fillStyle = '#0a0a20';
  ctx.fillRect(-20, H - GROUND_H, W + 40, GROUND_H);
  ctx.fillStyle = '#39ffeb';
  ctx.shadowColor = '#39ffeb'; ctx.shadowBlur = GLOW(14);
  ctx.fillRect(-20, H - GROUND_H, W + 40, 4);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ff2fd6';
  for (let x = 0; x < W; x += 48) ctx.fillRect(x + ((frame * 2) % 48), H - GROUND_H + 34, 22, 4);

  // bird
  drawBird();

  // particles (sparkles + feathers)
  for (const pt of particles) {
    ctx.globalAlpha = Math.max(0, pt.life / 40);
    ctx.fillStyle = pt.color;
    if (pt.kind === 'feather') {
      ctx.save();
      ctx.translate(pt.x, pt.y);
      ctx.rotate(pt.rot || 0);
      ctx.shadowColor = pt.color; ctx.shadowBlur = GLOW(8);
      ctx.beginPath(); ctx.ellipse(0, 0, pt.size, pt.size * 0.45, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    } else {
      ctx.shadowColor = pt.color; ctx.shadowBlur = GLOW(8);
      ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;

  // score popups (glowing)
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'center';
  for (const pp of popups) {
    ctx.globalAlpha = Math.max(0, pp.life / 40);
    ctx.fillStyle = '#ffe14d';
    ctx.shadowColor = '#ffe14d'; ctx.shadowBlur = GLOW(14);
    ctx.fillText(pp.text, pp.x, pp.y);
  }
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;

  // big score
  if (state === 'playing' || state === 'paused') {
    ctx.font = 'bold 52px sans-serif';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#39ffeb'; ctx.shadowBlur = GLOW(18);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(score), W / 2, 78);
    ctx.shadowBlur = 0;
    ctx.font = '16px sans-serif';
    ctx.fillStyle = '#bfefff';
    ctx.fillText('of ' + WIN_SCORE + ' pipes', W / 2, 104);
  }
  ctx.restore();
  // Score flash overlay (drawn unshaken, on top of everything)
  if (flash > 0) {
    ctx.fillStyle = 'rgba(125,249,255,' + (flash * 0.18).toFixed(3) + ')';
    ctx.fillRect(0, 0, W, H);
  }
}
function drawPipe(p) {
  const topH = p.gapY - p.gapH / 2, botY = p.gapY + p.gapH / 2;
  ctx.save();
  ctx.shadowColor = '#2bff5e'; ctx.shadowBlur = GLOW(16);
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
  ctx.shadowColor = '#ff2fd6'; ctx.shadowBlur = GLOW(20);
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
