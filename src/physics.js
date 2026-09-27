import {
  W, H, TOP_Y, BOTTOM_Y, CENTER_X, MID_Y,
  leftBoundAt, rightBoundAt, neckHalfWidth, setNeckHalfWidth,
} from "./geometry.js";
import { pickColor } from "./themes.js";

// ------------------------------------------------------------------
// 物理パラメータ
// ------------------------------------------------------------------
const GRAVITY = 950; // px/s^2
const SUBSTEPS = 6;
const COLLISION_ITERATIONS = 12;
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
export const SLEEP_TIME_REQUIRED = 0.3; // 秒
// 休止中の粒子は、これを超える速さで近づいてくる衝突を受けたときだけ目を覚ます
const WAKE_VELOCITY_THRESHOLD = 80; // px/s
const POINTER_REPULSION_RADIUS = 116;
const POINTER_REPULSION_STRENGTH = 1800;

// 「ふつう」の粒の半径。「細かい」は面積が半分になるよう 1/√2 倍にする。
const BASE_RADIUS = 4.5;
// count / neck はスライダーの範囲。サイズ切替時は multiplier / neckScale の比で値を換算する。
export const PARTICLE_SIZES = {
  normal: {
    multiplier: 1, radiusScale: 1, neckScale: 1,
    count: { min: 300, max: 1000, step: 50 },
    neck: { min: 12, max: 80, step: 2 },
  },
  fine: {
    multiplier: 2, radiusScale: Math.SQRT1_2, neckScale: .5,
    count: { min: 600, max: 2000, step: 100 },
    neck: { min: 6, max: 40, step: 1 },
  },
};

// シミュレーションの状態。pointerRepulsion は main.js がポインター操作に合わせて書き換える。
export const sim = {
  particles: [],
  particleRadius: BASE_RADIUS,
  pointerRepulsion: null,
};

let cellSize = sim.particleRadius * 3;
let gridCols = 1;
let gridRows = 1;
// セル先頭と次の粒子のインデックスを再利用。セルごとの配列生成を避ける。
let grid = new Int32Array(0);
let gridNext = new Int32Array(0);
let pairIndices = new Int32Array(65536);
let pairCount = 0;
let pairsValid = false;
let neighborX = new Float64Array(0);
let neighborY = new Float64Array(0);

export function wake(p) {
  p.resting = false;
  p.restTimer = 0;
}

export class Particle {
  constructor(x, y, r, color) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.r = r;
    this.color = color;
    this.resting = false;
    this.restTimer = 0;
  }
}

export function computeRadius(size) {
  return BASE_RADIUS * PARTICLE_SIZES[size].radiusScale;
}

// 上球内に、行ごとに粒子を敷き詰める形で初期配置する。
export function initParticles(requestedCount, size, colors) {
  pairsValid = false;
  sim.particleRadius = computeRadius(size);
  cellSize = sim.particleRadius * 3;
  gridCols = Math.max(1, Math.ceil(W / cellSize));
  gridRows = Math.max(1, Math.ceil(H / cellSize));

  const particles = [];
  const r = sim.particleRadius;
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
            r,
            pickColor(colors)
          )
        );
      }
    }
    y += spacingY;
  }
  sim.particles = particles;
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

  // 左右対称なので、右端は rightBoundAt と同じく W - left で求める（境界の計算を1回で済ませる）。
  const left = leftBoundAt(p.y);
  const lb = left + r;
  const rb = W - left - r;

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
function cellX(x) {
  return Math.min(gridCols - 1, Math.max(0, (x / cellSize) | 0));
}

function cellY(y) {
  return Math.min(gridRows - 1, Math.max(0, (y / cellSize) | 0));
}

function buildGrid() {
  const { particles } = sim;
  const size = gridCols * gridRows;
  if (grid.length !== size) {
    grid = new Int32Array(size);
  }
  grid.fill(-1);
  if (gridNext.length !== particles.length) gridNext = new Int32Array(particles.length);

  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    const cell = cellY(p.y) * gridCols + cellX(p.x);
    gridNext[i] = grid[cell];
    grid[cell] = i;
  }
}

// 床・下球の斜面・下側の砂粒のどれかに支えられているときだけ休止できる。
// 速度だけで休止させると、衝突補正で一時的に遅くなった粒が空中に固定されてしまう。
export function isParticleSupported(p) {
  if (p.y < MID_Y) return false;
  if (p.y >= BOTTOM_Y - p.r - 0.5) return true;

  const leftGap = p.x - (leftBoundAt(p.y) + p.r);
  const rightGap = (rightBoundAt(p.y) - p.r) - p.x;
  if (leftGap <= 0.5 || rightGap <= 0.5) return true;

  const { particles } = sim;
  const cx = cellX(p.x);
  const cy = cellY(p.y);
  for (let gy = cy; gy <= Math.min(gridRows - 1, cy + 1); gy++) {
    for (let gx = Math.max(0, cx - 1); gx <= Math.min(gridCols - 1, cx + 1); gx++) {
      for (let k = grid[gy * gridCols + gx]; k !== -1; k = gridNext[k]) {
        const q = particles[k];
        if (q === p || q.y <= p.y + p.r * 0.35) continue;
        const contactDistance = p.r + q.r + 0.5;
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        if (dx * dx + dy * dy <= contactDistance * contactDistance) return true;
      }
    }
  }
  return false;
}

export function resolvePair(a, b, positionOnly = false) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const minDist = a.r + b.r;
  const distanceSquared = dx * dx + dy * dy;
  if (distanceSquared >= minDist * minDist) return 0;
  let dist = Math.sqrt(distanceSquared);
  if (dist < 1e-6) dist = 1e-6;

  const nx = dist <= 1e-6 ? 1 : dx / dist;
  const ny = dist <= 1e-6 ? 0 : dy / dist;
  const overlap = minDist - dist;

  // 反転やくびれ変更で砂山が圧縮された場合は、低速でも休止を解除する。
  // 固定粒を押し合って局所的な重なりが残るのを防ぐ。
  if (overlap > minDist * .04) {
    wake(a);
    wake(b);
  }

  const rvx = b.vx - a.vx;
  const rvy = b.vy - a.vy;
  const velAlongNormal = rvx * nx + rvy * ny;
  const approachSpeed = -velAlongNormal; // 正なら近づいている

  // 休止中の粒子は、強い衝撃を受けたときだけ目を覚まして通常どおり動けるようにする。
  // （弱い接触のたびに毎回動かしてしまうと、いつまでも休止条件を満たせず山全体が
  //   静止できなくなるため）
  if (!positionOnly && approachSpeed > WAKE_VELOCITY_THRESHOLD) {
    if (a.resting) wake(a);
    if (b.resting) wake(b);
  }

  if (a.resting && b.resting) {
    // 休止状態でも重なったまま固定しない。
    const correction = Math.max(overlap - POSITION_SLOP, 0) / 2;
    a.x -= nx * correction;
    a.y -= ny * correction;
    b.x += nx * correction;
    b.y += ny * correction;
    return overlap;
  }

  // 補正を受け持つ割合。休止中の粒は動かさず、相手がすべて受け持つ。
  const aShare = a.resting ? 0 : b.resting ? 1 : 0.5;
  const bShare = 1 - aShare;

  // 微小なめり込みは補正しない（補正→再めり込みを繰り返す振動を防ぐ）
  const correction = Math.max(overlap - POSITION_SLOP, 0) * POSITION_CORRECTION_PERCENT;
  if (correction > 0) {
    a.x -= nx * correction * aShare;
    a.y -= ny * correction * aShare;
    b.x += nx * correction * bShare;
    b.y += ny * correction * bShare;
  }

  // 反発・摩擦は最初の反復で解決し、以後は位置の収束だけを行う。
  // 最終速度は補正後の移動量から再計算するため、同じ摩擦を重ねない。
  if (positionOnly) return overlap;
  if (velAlongNormal < 0) {
    // ゆっくりとした接触（静止に近い状態）は反発させず、運動量を吸収して止める。
    // これにより積み重なった粒子がいつまでも弾み続けるのを防ぐ。
    const restitution = approachSpeed < REST_VELOCITY_THRESHOLD ? 0 : RESTITUTION_PARTICLE;
    const totalImpulse = -(1 + restitution) * velAlongNormal;
    a.vx -= totalImpulse * aShare * nx;
    a.vy -= totalImpulse * aShare * ny;
    b.vx += totalImpulse * bShare * nx;
    b.vy += totalImpulse * bShare * ny;
  }

  const tx = -ny;
  const ty = nx;
  const rvt = (b.vx - a.vx) * tx + (b.vy - a.vy) * ty;
  const friction = rvt * FRICTION_PARTICLE;
  a.vx += tx * (friction * aShare);
  a.vy += ty * (friction * aShare);
  b.vx -= tx * (friction * bShare);
  b.vy -= ty * (friction * bShare);
  return overlap;
}

// 半径1個分の余裕を持つ近傍リスト。各粒の移動が半径の半分を
// 超える前に再構築すれば、新しい接触も漏らさず同じ組合せを使える。
function buildCollisionPairs() {
  const { particles } = sim;
  buildGrid();
  if (neighborX.length !== particles.length) {
    neighborX = new Float64Array(particles.length);
    neighborY = new Float64Array(particles.length);
  }
  pairCount = 0;
  pairsValid = true;
  const reach = sim.particleRadius * 3;
  const cells = Math.ceil(reach / cellSize);
  // 下から上へ解くと、床に支えられた砂の補正を上の粒へ伝えやすい。
  for (let occupied = grid.length - 1; occupied >= 0; occupied--) {
    for (let i = grid[occupied]; i !== -1; i = gridNext[i]) {
      const p = particles[i];
      neighborX[i] = p.x;
      neighborY[i] = p.y;
      const cx = cellX(p.x);
      const cy = cellY(p.y);
      for (let gy = Math.max(0, cy - cells); gy <= Math.min(gridRows - 1, cy + cells); gy++) {
        for (let gx = Math.max(0, cx - cells); gx <= Math.min(gridCols - 1, cx + cells); gx++) {
          for (let j = grid[gy * gridCols + gx]; j !== -1; j = gridNext[j]) {
            if (j <= i) continue;
            const q = particles[j];
            const dx = p.x - q.x;
            const dy = p.y - q.y;
            if (dx * dx + dy * dy > reach * reach) continue;
            if (pairCount + 2 > pairIndices.length) {
              const expanded = new Int32Array(pairIndices.length * 2);
              expanded.set(pairIndices);
              pairIndices = expanded;
            }
            pairIndices[pairCount++] = i;
            pairIndices[pairCount++] = j;
          }
        }
      }
    }
  }
}

// 粒同士の重なりと壁へのめり込みを、近傍ペアを使って反復で解消する。
// 反発・摩擦は最初の反復だけで扱い、以後は位置の収束だけを行う。
function solveContacts() {
  const { particles } = sim;
  const travelLimitSquared = sim.particleRadius * sim.particleRadius * .25;
  if (pairsValid) {
    for (let i = 0; i < particles.length; i++) {
      const dx = particles[i].x - neighborX[i];
      const dy = particles[i].y - neighborY[i];
      if (dx * dx + dy * dy >= travelLimitSquared) { pairsValid = false; break; }
    }
  }
  if (!pairsValid) buildCollisionPairs();
  for (let iter = 0; iter < COLLISION_ITERATIONS; iter++) {
    for (let n = 0; n < pairCount; n += 2) {
      resolvePair(particles[pairIndices[n]], particles[pairIndices[n + 1]], iter > 0);
    }
    let rebuild = false;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      containParticle(p);
      const dx = p.x - neighborX[i];
      const dy = p.y - neighborY[i];
      if (dx * dx + dy * dy >= travelLimitSquared) rebuild = true;
    }
    if (rebuild) {
      pairsValid = false;
      if (iter + 1 < COLLISION_ITERATIONS) buildCollisionPairs();
    }
  }
}

function applyPointerRepulsion(dt) {
  const { particles, pointerRepulsion } = sim;
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
    if (p.resting) wake(p);
  }
}

// ------------------------------------------------------------------
// シミュレーションステップ
// ------------------------------------------------------------------
export function step(dt) {
  const { particles } = sim;
  const particleRadius = sim.particleRadius;
  // 長いフレームや速い粒子でも一度に半径以上進ませず、すり抜けを防ぐ。
  let maxSpeed = 0;
  for (const p of particles) maxSpeed = Math.max(maxSpeed, Math.abs(p.vx), Math.abs(p.vy));
  const substeps = Math.min(24, Math.max(Math.ceil(SUBSTEPS * dt * 60), Math.ceil((maxSpeed + GRAVITY * dt) * dt / particleRadius), 1));
  const subDt = dt / substeps;
  const damping = Math.pow(VELOCITY_DAMPING, subDt * 480);
  const wallFrictionFactor = Math.pow(WALL_FRICTION_PER_SECOND, subDt);

  for (let s = 0; s < substeps; s++) {
    buildGrid();
    applyPointerRepulsion(subDt);
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      if (p.resting && !isParticleSupported(p)) wake(p);
      p.previousX = p.x;
      p.previousY = p.y;
      if (!p.resting) {
        p.vy += GRAVITY * subDt;
        p.vx *= damping;
        p.vy *= damping;
        p.x += p.vx * subDt;
        p.y += p.vy * subDt;
      }
      containParticle(p); // 位置補正のみ（摩擦はここでは適用しない）
    }

    solveContacts();
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
      wake(p);
    }
  }
}

// 全粒が支えられて休止し、ポインターでよけてもいなければ、砂は止まったまま変わらない。
export function isSettled() {
  return !sim.pointerRepulsion && sim.particles.every(p => p.resting);
}

// 砂時計を180度回転させる = 各粒子を中心点に対して点対称に反転
export function flipParticles() {
  for (const p of sim.particles) {
    p.x = W - p.x;
    p.y = H - p.y;
    p.vx = -p.vx;
    p.vy = -p.vy;
    wake(p); // 休止中の粒子も反転後は落下を再開させる
  }
}

// くびれの幅を変え、砂の数と配置を引き継いだまま新しい形に収める。
export function changeNeckHalfWidth(newWidth) {
  const { particles } = sim;
  const oldWidth = neckHalfWidth;
  // 壁を一瞬で押し込まず、幅の中での相対位置を保って移す。
  const oldBounds = particles.map(p => rightBoundAt(p.y) - CENTER_X - p.r);
  setNeckHalfWidth(newWidth);
  particles.forEach((p, index) => {
    const newBound = rightBoundAt(p.y) - CENTER_X - p.r;
    if (oldWidth !== newWidth && oldBounds[index] > 0) {
      p.x = CENTER_X + (p.x - CENTER_X) * newBound / oldBounds[index];
    }
    p.vx = 0;
    p.vy = 0;
    wake(p);
    containParticle(p);
  });
  // 幅の変更による重なりも、次の描画前に解消する（速度は0なので位置の補正だけになる）。
  pairsValid = false;
  solveContacts();
}
