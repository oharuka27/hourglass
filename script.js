"use strict";

// ------------------------------------------------------------------
// キャンバス・砂時計の形状パラメータ
// ------------------------------------------------------------------
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const W = canvas.width;
const H = canvas.height;

const MARGIN = 60;
const OUTER_LEFT = MARGIN;
const OUTER_RIGHT = W - MARGIN;
const TOP_Y = 50;
const BOTTOM_Y = H - 50;
const CENTER_X = W / 2;
let NECK_HALF_WIDTH = 14;
const NECK_HEIGHT = 26;
const MID_Y = (TOP_Y + BOTTOM_Y) / 2;
const NECK_TOP_Y = MID_Y - NECK_HEIGHT / 2;
const NECK_BOTTOM_Y = MID_Y + NECK_HEIGHT / 2;

// 丸いガラスの描画と衝突判定には同じ境界を使う。
function leftBoundAt(y) {
  const distance = Math.abs(y - MID_Y);
  const t = Math.max(0, Math.min(1, (distance - NECK_HEIGHT / 2) / (NECK_TOP_Y - TOP_Y)));
  const curve = (1 - Math.cos(Math.PI * t)) / 2;
  return CENTER_X - NECK_HALF_WIDTH - (CENTER_X - NECK_HALF_WIDTH - OUTER_LEFT) * curve;
}

function rightBoundAt(y) {
  return W - leftBoundAt(y);
}

function glassPath() {
  ctx.beginPath();
  ctx.moveTo(leftBoundAt(TOP_Y), TOP_Y);
  ctx.lineTo(rightBoundAt(TOP_Y), TOP_Y);
  for (let y = TOP_Y; y <= BOTTOM_Y; y += 2) ctx.lineTo(rightBoundAt(y), y);
  ctx.lineTo(leftBoundAt(BOTTOM_Y), BOTTOM_Y);
  for (let y = BOTTOM_Y; y >= TOP_Y; y -= 2) ctx.lineTo(leftBoundAt(y), y);
  ctx.closePath();
}

// ------------------------------------------------------------------
// 物理パラメータ
// ------------------------------------------------------------------
const GRAVITY = 950; // px/s^2
const SUBSTEPS = 8;
const COLLISION_ITERATIONS = 16;
const VELOCITY_DAMPING = 0.995;
const RESTITUTION_PARTICLE = 0.15;
const FRICTION_PARTICLE = 0.5;
const RESTITUTION_WALL = 0.25;
// 壁に接触し続けた場合、1秒あたりに残る壁沿い方向速度の割合（0.5なら1秒でおよそ半分に減衰）
const WALL_FRICTION_PER_SECOND = 0.5;

// 粒子同士の相対速度がこれより小さい衝突は反発させず、運動量を吸収する（静止摩擦的な挙動）
const REST_VELOCITY_THRESHOLD = 60; // px/s
// これ未満のめり込みは位置補正しない（補正→再めり込みを繰り返す微振動ループを防ぐ）
const POSITION_SLOP = 0.01; // px
// 接触ごとに重なりを解消する。補正後の位置から速度を求め、圧縮を蓄積させない。
const POSITION_CORRECTION_PERCENT = 1;

// 一定時間ほぼ静止した粒子は「休止」させ、重力・自発的な移動を止める。
// 積み重なった粒子の接触解決は反復回数が少ないと下からの支持力が上まで伝わりきらず、
// 山全体がいつまでも小さく弾み続けてしまうため、静止した粒子を能動的に止めることで解決する。
// ただし休止中も周囲の粒子からの衝突（位置補正・速度伝達）は通常どおり受けるため、
// 強い衝撃（反転操作など）を受ければ自然に目を覚まして動き出す。
const SLEEP_SPEED_THRESHOLD = 20; // px/s
const SLEEP_TIME_REQUIRED = 0.3; // 秒
// 休止中の粒子は、これを超える速さで近づいてくる衝突を受けたときだけ目を覚ます
const WAKE_VELOCITY_THRESHOLD = 80; // px/s
const POINTER_REPULSION_RADIUS = 116;
const POINTER_REPULSION_STRENGTH = 1800;

const REF_PARTICLE_COUNT = 2000;
const BASE_RADIUS = 3.2;
const MIN_RADIUS = 1.3;
const MAX_RADIUS = 4.5;

const SAND_COLORS = ["#d5ae70", "#e5c58c", "#c6a069", "#efdaa7", "#ddbb82"];

let PARTICLE_RADIUS = BASE_RADIUS;
let particles = [];
let cellSize = PARTICLE_RADIUS * 2.2;
let gridCols = 1;
let gridRows = 1;
let grid = [];
let pointerRepulsion = null;
let pointerTap = null;

class Particle {
  constructor(x, y, r) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.r = r;
    this.color = SAND_COLORS[(Math.random() * SAND_COLORS.length) | 0];
    this.resting = false;
    this.restTimer = 0;
  }
}

// 粒子半径は要求粒子数に応じて動的に決める。
// 粒子数が増えるほど半径を小さくし、上球に収まりやすくする。
function computeRadius(count) {
  const r = BASE_RADIUS * Math.sqrt(REF_PARTICLE_COUNT / count);
  return Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, r));
}

// 上球内に、行ごとに粒子を敷き詰める形で初期配置する。
function initParticles(requestedCount) {
  PARTICLE_RADIUS = computeRadius(requestedCount);
  cellSize = PARTICLE_RADIUS * 2.2;
  gridCols = Math.max(1, Math.ceil(W / cellSize));
  gridRows = Math.max(1, Math.ceil(H / cellSize));

  particles = [];
  const r = PARTICLE_RADIUS;
  const spacingY = r * 2.05;
  let y = TOP_Y + r * 1.5;

  // 上球に収まりきらない場合は、ネック・下球側にも続けて敷き詰める
  while (particles.length < requestedCount && y < BOTTOM_Y - r) {
    const leftX = leftBoundAt(y) + r;
    const rightX = rightBoundAt(y) - r;
    const rowWidth = rightX - leftX;
    if (rowWidth > 0) {
      const spacingX = r * 2.05;
      const cols = Math.max(1, Math.floor(rowWidth / spacingX) + 1);
      for (let c = 0; c < cols && particles.length < requestedCount; c++) {
        const x = cols === 1 ? (leftX + rightX) / 2 : leftX + (c * rowWidth) / (cols - 1);
        particles.push(
          new Particle(
            x + (Math.random() - 0.5) * 0.5,
            y + (Math.random() - 0.5) * 0.5,
            r
          )
        );
      }
    }
    y += spacingY;
  }

  document.getElementById("particleActual").textContent =
    `配置粒子数: ${particles.length} / 要求: ${requestedCount}`;
}

// ------------------------------------------------------------------
// 壁との衝突（高さごとの左右境界にクランプする方式）
// ------------------------------------------------------------------
// frictionFactor を渡したときだけ、壁沿い方向の速度に摩擦を適用する。
// （1フレーム中に何度も呼ばれるため、摩擦は呼び出し側で1サブステップにつき1回だけ有効にする）
function containParticle(p, frictionFactor) {
  const r = p.r;

  if (p.y < TOP_Y + r) {
    p.y = TOP_Y + r;
    if (p.vy < 0) {
      p.vy = -p.vy < REST_VELOCITY_THRESHOLD ? 0 : p.vy * -RESTITUTION_WALL;
    }
    if (frictionFactor !== undefined) p.vx *= frictionFactor;
  } else if (p.y > BOTTOM_Y - r) {
    p.y = BOTTOM_Y - r;
    if (p.vy > 0) {
      p.vy = p.vy < REST_VELOCITY_THRESHOLD ? 0 : p.vy * -RESTITUTION_WALL;
    }
    if (frictionFactor !== undefined) p.vx *= frictionFactor;
  }

  const lb = leftBoundAt(p.y) + r;
  const rb = rightBoundAt(p.y) - r;

  if (p.x < lb || p.x > rb) {
    const leftWall = p.x < lb;
    const slope = (leftBoundAt(p.y + 0.1) - leftBoundAt(p.y - 0.1)) / 0.2;
    const length = Math.hypot(1, slope);
    const nx = (leftWall ? 1 : -1) / length;
    const ny = -slope / length;
    const penetration = (leftWall ? lb - p.x : p.x - rb) / length;
    // 水平方向に押し込むと、くびれで粒が一列に圧縮される。
    // 壁の法線方向へ戻し、斜面に沿って滑れるようにする。
    p.x += nx * penetration;
    p.y += ny * penetration;
    const normalVelocity = p.vx * nx + p.vy * ny;
    if (normalVelocity < 0) {
      p.vx -= nx * normalVelocity;
      p.vy -= ny * normalVelocity;
    }
    if (frictionFactor !== undefined) {
      p.vx *= frictionFactor;
      p.vy *= frictionFactor;
    }
  }
}

// ------------------------------------------------------------------
// 粒子同士の衝突（空間分割グリッドで近傍のみ判定）
// ------------------------------------------------------------------
function buildGrid() {
  const size = gridCols * gridRows;
  if (grid.length !== size) {
    grid = new Array(size);
    for (let i = 0; i < size; i++) grid[i] = [];
  } else {
    for (let i = 0; i < size; i++) grid[i].length = 0;
  }

  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    const cx = Math.min(gridCols - 1, Math.max(0, (p.x / cellSize) | 0));
    const cy = Math.min(gridRows - 1, Math.max(0, (p.y / cellSize) | 0));
    grid[cy * gridCols + cx].push(i);
  }
}

// 床・下球の斜面・下側の砂粒のどれかに支えられているときだけ休止できる。
// 速度だけで休止させると、衝突補正で一時的に遅くなった粒が空中に固定されてしまう。
function isParticleSupported(p) {
  if (p.y < MID_Y) return false;
  if (p.y >= BOTTOM_Y - p.r - 0.5) return true;

  const leftGap = p.x - (leftBoundAt(p.y) + p.r);
  const rightGap = (rightBoundAt(p.y) - p.r) - p.x;
  if (leftGap <= 0.5 || rightGap <= 0.5) return true;

  const cx = Math.min(gridCols - 1, Math.max(0, (p.x / cellSize) | 0));
  const cy = Math.min(gridRows - 1, Math.max(0, (p.y / cellSize) | 0));
  for (let gy = cy; gy <= Math.min(gridRows - 1, cy + 1); gy++) {
    for (let gx = Math.max(0, cx - 1); gx <= Math.min(gridCols - 1, cx + 1); gx++) {
      const cell = grid[gy * gridCols + gx];
      for (let k = 0; k < cell.length; k++) {
        const q = particles[cell[k]];
        if (q === p || q.y <= p.y + p.r * 0.35) continue;
        const contactDistance = p.r + q.r + 0.5;
        if (Math.hypot(q.x - p.x, q.y - p.y) <= contactDistance) return true;
      }
    }
  }
  return false;
}

function resolvePair(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const minDist = a.r + b.r;
  const distanceSquared = dx * dx + dy * dy;
  if (distanceSquared >= minDist * minDist) return;
  let dist = Math.sqrt(distanceSquared);
  if (dist < 1e-6) dist = 1e-6;

  const nx = dist <= 1e-6 ? 1 : dx / dist;
  const ny = dist <= 1e-6 ? 0 : dy / dist;
  const overlap = minDist - dist;

  const rvx = b.vx - a.vx;
  const rvy = b.vy - a.vy;
  const velAlongNormal = rvx * nx + rvy * ny;
  const approachSpeed = -velAlongNormal; // 正なら近づいている

  // 休止中の粒子は、強い衝撃を受けたときだけ目を覚まして通常どおり動けるようにする。
  // （弱い接触のたびに毎回動かしてしまうと、いつまでも休止条件を満たせず山全体が
  //   静止できなくなるため）
  if (a.resting && approachSpeed > WAKE_VELOCITY_THRESHOLD) {
    a.resting = false;
    a.restTimer = 0;
  }
  if (b.resting && approachSpeed > WAKE_VELOCITY_THRESHOLD) {
    b.resting = false;
    b.restTimer = 0;
  }

  const aFixed = a.resting;
  const bFixed = b.resting;
  if (aFixed && bFixed) {
    // 休止状態でも重なったまま固定しない。
    const correction = Math.max(overlap - POSITION_SLOP, 0) / 2;
    a.x -= nx * correction;
    a.y -= ny * correction;
    b.x += nx * correction;
    b.y += ny * correction;
    return;
  }

  // 微小なめり込みは補正しない（補正→再めり込みを繰り返す振動を防ぐ）
  const correction = Math.max(overlap - POSITION_SLOP, 0) * POSITION_CORRECTION_PERCENT;
  if (correction > 0) {
    if (aFixed) {
      b.x += nx * correction;
      b.y += ny * correction;
    } else if (bFixed) {
      a.x -= nx * correction;
      a.y -= ny * correction;
    } else {
      a.x -= nx * correction * 0.5;
      a.y -= ny * correction * 0.5;
      b.x += nx * correction * 0.5;
      b.y += ny * correction * 0.5;
    }
  }

  if (velAlongNormal < 0) {
    // ゆっくりとした接触（静止に近い状態）は反発させず、運動量を吸収して止める。
    // これにより積み重なった粒子がいつまでも弾み続けるのを防ぐ。
    const restitution = approachSpeed < REST_VELOCITY_THRESHOLD ? 0 : RESTITUTION_PARTICLE;
    const totalImpulse = -(1 + restitution) * velAlongNormal;
    if (aFixed) {
      b.vx += totalImpulse * nx;
      b.vy += totalImpulse * ny;
    } else if (bFixed) {
      a.vx -= totalImpulse * nx;
      a.vy -= totalImpulse * ny;
    } else {
      const jImpulse = totalImpulse / 2;
      a.vx -= jImpulse * nx;
      a.vy -= jImpulse * ny;
      b.vx += jImpulse * nx;
      b.vy += jImpulse * ny;
    }
  }

  const tx = -ny;
  const ty = nx;
  const rvt = (b.vx - a.vx) * tx + (b.vy - a.vy) * ty;
  if (aFixed) {
    b.vx -= tx * rvt * FRICTION_PARTICLE;
    b.vy -= ty * rvt * FRICTION_PARTICLE;
  } else if (bFixed) {
    a.vx += tx * rvt * FRICTION_PARTICLE;
    a.vy += ty * rvt * FRICTION_PARTICLE;
  } else {
    const frictionImpulse = rvt * FRICTION_PARTICLE * 0.5;
    a.vx += tx * frictionImpulse;
    a.vy += ty * frictionImpulse;
    b.vx -= tx * frictionImpulse;
    b.vy -= ty * frictionImpulse;
  }
}

function resolveParticleCollisions() {
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    const cx = Math.min(gridCols - 1, Math.max(0, (p.x / cellSize) | 0));
    const cy = Math.min(gridRows - 1, Math.max(0, (p.y / cellSize) | 0));

    for (let gy = cy - 1; gy <= cy + 1; gy++) {
      if (gy < 0 || gy >= gridRows) continue;
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        if (gx < 0 || gx >= gridCols) continue;
        const cell = grid[gy * gridCols + gx];
        for (let k = 0; k < cell.length; k++) {
          const j = cell[k];
          if (j <= i) continue;
          resolvePair(p, particles[j]);
        }
      }
    }
  }
}

function applyPointerRepulsion(dt) {
  if (!pointerRepulsion) return;
  const radius = POINTER_REPULSION_RADIUS;
  const radiusSquared = radius * radius;
  for (const p of particles) {
    const dx = p.x - pointerRepulsion.x;
    const dy = p.y - pointerRepulsion.y;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared >= radiusSquared) continue;

    const distance = Math.sqrt(distanceSquared);
    const falloff = 1 - distance / radius;
    const nx = distance > 1e-6 ? dx / distance : 0;
    const ny = distance > 1e-6 ? dy / distance : -1;
    const impulse = POINTER_REPULSION_STRENGTH * falloff * dt;
    p.vx += nx * impulse;
    p.vy += ny * impulse;
    if (p.resting) {
      p.resting = false;
      p.restTimer = 0;
    }
  }
}

// ------------------------------------------------------------------
// シミュレーションステップ
// ------------------------------------------------------------------
function step(dt) {
  const subDt = dt / SUBSTEPS;
  const wallFrictionFactor = Math.pow(WALL_FRICTION_PER_SECOND, subDt);

  for (let s = 0; s < SUBSTEPS; s++) {
    buildGrid();
    applyPointerRepulsion(subDt);
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      if (p.resting && !isParticleSupported(p)) {
        p.resting = false;
        p.restTimer = 0;
      }
      p.previousX = p.x;
      p.previousY = p.y;
      if (!p.resting) {
        p.vy += GRAVITY * subDt;
        p.vx *= VELOCITY_DAMPING;
        p.vy *= VELOCITY_DAMPING;
        p.x += p.vx * subDt;
        p.y += p.vy * subDt;
      }
      containParticle(p); // 位置補正のみ（摩擦はここでは適用しない）
    }

    for (let iter = 0; iter < COLLISION_ITERATIONS; iter++) {
      // 位置補正で近傍が変わるため、各反復で探索用グリッドを更新する。
      buildGrid();
      resolveParticleCollisions();
      for (const p of particles) containParticle(p);
    }
    if (subDt > 0) {
      for (const p of particles) {
        p.vx = (p.x - p.previousX) / subDt;
        p.vy = (p.y - p.previousY) / subDt;
      }
    }
    for (let i = 0; i < particles.length; i++) {
      // このサブステップで壁に接触している場合、ここで1回だけ摩擦を適用
      containParticle(particles[i], wallFrictionFactor);
    }
  }

  // 支えがある状態で一定時間ほぼ静止していた粒子だけを休止させる。
  buildGrid();
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    const speed2 = p.vx * p.vx + p.vy * p.vy;
    if (isParticleSupported(p) && speed2 < SLEEP_SPEED_THRESHOLD * SLEEP_SPEED_THRESHOLD) {
      p.restTimer += dt;
      if (p.restTimer > SLEEP_TIME_REQUIRED) {
        p.resting = true;
        p.vx = 0;
        p.vy = 0;
      }
    } else {
      p.restTimer = 0;
      p.resting = false;
    }
  }
}

// ------------------------------------------------------------------
// 描画
// ------------------------------------------------------------------
function draw() {
  ctx.clearRect(0, 0, W, H);

  ctx.save();
  ctx.translate(CENTER_X, MID_Y);
  const turnScale = 1 - 0.4 * Math.sin(flipAngle);
  ctx.scale(turnScale, turnScale);
  ctx.rotate(flipAngle);
  ctx.translate(-CENTER_X, -MID_Y);
  glassPath();
  const glass = ctx.createLinearGradient(OUTER_LEFT, 0, OUTER_RIGHT, 0);
  glass.addColorStop(0, "rgba(255,255,255,.75)");
  glass.addColorStop(.45, "rgba(255,255,255,.12)");
  glass.addColorStop(1, "rgba(255,255,255,.65)");
  ctx.fillStyle = glass;
  ctx.fill();
  ctx.strokeStyle = "#acbba1";
  ctx.lineWidth = 3;
  ctx.stroke();

  for (const y of [TOP_Y - 23, BOTTOM_Y - 1]) {
    ctx.beginPath();
    ctx.roundRect(OUTER_LEFT - 18, y, OUTER_RIGHT - OUTER_LEFT + 36, 24, 12);
    ctx.fillStyle = "#81916c";
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(OUTER_LEFT - 12, y + 3, OUTER_RIGHT - OUTER_LEFT + 24, 6, 3);
    ctx.fillStyle = "#a3b18d";
    ctx.fill();
  }
  ctx.save();
  glassPath();
  ctx.clip();
  // 砂粒子
  const particlesByColor = new Map();
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    let coloredParticles = particlesByColor.get(p.color);
    if (!coloredParticles) {
      coloredParticles = [];
      particlesByColor.set(p.color, coloredParticles);
    }
    coloredParticles.push(p);
  }
  for (const [color, coloredParticles] of particlesByColor) {
    ctx.beginPath();
    for (const p of coloredParticles) {
      ctx.moveTo(p.x + p.r, p.y);
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    }
    ctx.fillStyle = color;
    ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle = "rgba(255,255,255,.8)";
  ctx.lineWidth = 7;
  ctx.lineCap = "round";
  for (const start of [TOP_Y + 32, NECK_BOTTOM_Y + 110]) {
    ctx.beginPath();
    for (let y = start; y < start + 105; y += 2) {
      const x = leftBoundAt(y) + 15;
      if (y === start) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

// ------------------------------------------------------------------
// メインループ / FPS計測
// ------------------------------------------------------------------
let lastTime = performance.now();
let fpsSmoothed = 60;
const fpsEl = document.getElementById("fps");

function loop(now) {
  let dt = (now - lastTime) / 1000;
  lastTime = now;
  dt = Math.min(dt, 1 / 30); // タブ切り替え等での大ジャンプを防ぐ

  if (flipStarted !== null) {
    const progress = Math.min(1, (now - flipStarted) / 650);
    flipAngle = Math.PI * progress * progress * (3 - 2 * progress);
    if (progress === 1) finishFlip();
  } else {
    step(dt);
  }
  draw();

  const instFps = dt > 0 ? 1 / dt : 60;
  fpsSmoothed += (instFps - fpsSmoothed) * 0.1;
  fpsEl.textContent = `FPS: ${fpsSmoothed.toFixed(0)}`;

  requestAnimationFrame(loop);
}

// ------------------------------------------------------------------
// UI
// ------------------------------------------------------------------
const particleCountInput = document.getElementById("particleCount");
const particleCountValue = document.getElementById("particleCountValue");
const resetBtn = document.getElementById("resetBtn");
const flipBtn = document.getElementById("flipBtn");
const hourglassBtn = document.getElementById("hourglassBtn");
const scene = document.querySelector?.(".scene");

function getCanvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * W / rect.width,
    y: (event.clientY - rect.top) * H / rect.height,
  };
}

function isInsideGlass(point) {
  if (point.y < TOP_Y || point.y > BOTTOM_Y) return false;
  return point.x >= leftBoundAt(point.y) && point.x <= rightBoundAt(point.y);
}

function updatePointerRepulsion(event) {
  const point = getCanvasPoint(event);
  pointerRepulsion = { ...point, pointerId: event.pointerId };
}

function stopPointerRepulsion(event) {
  if (!pointerRepulsion || event.pointerId === pointerRepulsion.pointerId) {
    pointerRepulsion = null;
  }
}

function finishPointerTap(event) {
  if (pointerTap?.pointerId === event.pointerId) {
    pointerTap.releasedInside = isInsideGlass(getCanvasPoint(event));
  }
  stopPointerRepulsion(event);
}

hourglassBtn.addEventListener("pointerdown", event => {
  const point = getCanvasPoint(event);
  pointerTap = { pointerId: event.pointerId, insideGlass: isInsideGlass(point) };
  if (pointerTap.insideGlass) updatePointerRepulsion(event);
  hourglassBtn.setPointerCapture?.(event.pointerId);
});
hourglassBtn.addEventListener("pointermove", event => {
  if (pointerTap?.insideGlass && pointerTap.pointerId === event.pointerId) {
    updatePointerRepulsion(event);
  }
});
hourglassBtn.addEventListener("pointerup", finishPointerTap);
hourglassBtn.addEventListener("pointercancel", event => {
  stopPointerRepulsion(event);
  pointerTap = null;
});
hourglassBtn.addEventListener("lostpointercapture", event => {
  stopPointerRepulsion(event);
});

const neckWidthInput = document.getElementById("neckWidth");
const neckWidthValue = document.getElementById("neckWidthValue");
neckWidthInput.addEventListener("input", () => {
  const oldWidth = NECK_HALF_WIDTH;
  const newWidth = Number(neckWidthInput.value) / 2;
  // 壁を一瞬で押し込まず、幅の中での相対位置を保って移す。
  const oldBounds = particles.map(p => rightBoundAt(p.y) - CENTER_X - p.r);
  NECK_HALF_WIDTH = newWidth;
  particles.forEach((p, index) => {
    const newBound = rightBoundAt(p.y) - CENTER_X - p.r;
    if (oldWidth !== newWidth && oldBounds[index] > 0) {
      p.x = CENTER_X + (p.x - CENTER_X) * newBound / oldBounds[index];
    }
    p.vx = 0;
    p.vy = 0;
    p.resting = false;
    p.restTimer = 0;
    containParticle(p);
  });
  // 幅の変更による重なりも、次の描画前に解消する。
  for (let i = 0; i < COLLISION_ITERATIONS; i++) {
    buildGrid();
    resolveParticleCollisions();
    for (const p of particles) containParticle(p);
  }
  neckWidthValue.textContent = neckWidthInput.value;
  draw();
});

particleCountInput.addEventListener("input", () => {
  particleCountValue.textContent = particleCountInput.value;
});

resetBtn.addEventListener("click", () => {
  if (flipStarted !== null) finishFlip();
  initParticles(parseInt(particleCountInput.value, 10));
});

let flipStarted = null;
let flipAngle = 0;
function finishFlip() {
  // 砂時計を180度回転させる = 各粒子を中心点に対して点対称に反転
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    p.x = W - p.x;
    p.y = H - p.y;
    p.vx = -p.vx;
    p.vy = -p.vy;
    p.resting = false; // 休止中の粒子も反転後は落下を再開させる
    p.restTimer = 0;
  }
  flipStarted = null;
  flipAngle = 0;
  document.getElementById("flipStatus").textContent = "砂時計の上下を入れ替えました";
}

function flipHourglass() {
  if (flipStarted !== null) return;
  document.getElementById("flipStatus").textContent = "";
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    finishFlip();
  } else {
    flipStarted = performance.now();
  }
}
flipBtn.addEventListener("click", flipHourglass);
hourglassBtn.addEventListener("click", event => {
  if (pointerTap?.insideGlass || pointerTap?.releasedInside) {
    event.preventDefault();
    pointerTap = null;
    return;
  }
  pointerTap = null;
  flipHourglass();
});
scene?.addEventListener("click", event => {
  if (event.target.closest("#hourglassBtn")) return;
  flipHourglass();
});

// ------------------------------------------------------------------
// 起動
// ------------------------------------------------------------------
initParticles(parseInt(particleCountInput.value, 10));
requestAnimationFrame(loop);
