import {
  W, H, OUTER_LEFT, OUTER_RIGHT, TOP_Y, BOTTOM_Y, CENTER_X, MID_Y, NECK_BOTTOM_Y,
  leftBoundAt, rightBoundAt, neckHalfWidth,
} from "./geometry.js";

function glassPath() {
  const path = new Path2D();
  path.moveTo(leftBoundAt(TOP_Y), TOP_Y);
  path.lineTo(rightBoundAt(TOP_Y), TOP_Y);
  for (let y = TOP_Y; y <= BOTTOM_Y; y += 2) path.lineTo(rightBoundAt(y), y);
  path.lineTo(leftBoundAt(BOTTOM_Y), BOTTOM_Y);
  for (let y = BOTTOM_Y; y >= TOP_Y; y -= 2) path.lineTo(leftBoundAt(y), y);
  path.closePath();
  return path;
}

function createLayer(paint) {
  const layer = document.createElement("canvas");
  layer.width = W;
  layer.height = H;
  paint(layer.getContext("2d"));
  return layer;
}

// ガラス本体・蓋（砂の奥）とガラスのハイライト（砂の手前）は形が変わらない限り同じ見た目なので、
// くびれの幅が変わったときだけオフスクリーンに描き直す。
let layers = null;

function getLayers() {
  if (layers?.neckHalfWidth === neckHalfWidth) return layers;
  const glass = glassPath();
  const back = createLayer(ctx => {
    const gradient = ctx.createLinearGradient(OUTER_LEFT, 0, OUTER_RIGHT, 0);
    gradient.addColorStop(0, "rgba(255,255,255,.75)");
    gradient.addColorStop(.45, "rgba(255,255,255,.12)");
    gradient.addColorStop(1, "rgba(255,255,255,.65)");
    ctx.fillStyle = gradient;
    ctx.fill(glass);
    ctx.strokeStyle = "#acbba1";
    ctx.lineWidth = 3;
    ctx.stroke(glass);

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
  });
  const front = createLayer(ctx => {
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
  });
  layers = { neckHalfWidth, glass, back, front };
  return layers;
}

// 描画用に粒を色ごとにまとめる。粒の入れ替えと色の変更のときだけ作り直す。
export function groupParticlesByColor(particles) {
  const particlesByColor = new Map();
  for (const p of particles) {
    let coloredParticles = particlesByColor.get(p.color);
    if (!coloredParticles) {
      coloredParticles = [];
      particlesByColor.set(p.color, coloredParticles);
    }
    coloredParticles.push(p);
  }
  return particlesByColor;
}

// flipAngle は反転アニメーション中の回転角（ラジアン）。
export function draw(ctx, particles, particlesByColor, flipAngle) {
  ctx.clearRect(0, 0, W, H);

  ctx.save();
  ctx.translate(CENTER_X, MID_Y);
  const turnScale = 1 - 0.4 * Math.sin(flipAngle);
  ctx.scale(turnScale, turnScale);
  ctx.rotate(flipAngle);
  ctx.translate(-CENTER_X, -MID_Y);
  const { glass, back, front } = getLayers();
  ctx.drawImage(back, 0, 0);
  ctx.save();
  ctx.clip(glass);
  // 砂粒子
  for (const [color, coloredParticles] of particlesByColor) {
    // 粒の下側にごく小さな影を置き、背景から浮いて見えるのを抑える。
    ctx.beginPath();
    for (const p of coloredParticles) {
      ctx.moveTo(p.x + p.r, p.y + p.r * 0.2);
      ctx.arc(p.x, p.y + p.r * 0.2, p.r, 0, Math.PI * 2);
    }
    ctx.fillStyle = "rgba(76, 52, 29, .22)";
    ctx.fill();

    ctx.beginPath();
    for (const p of coloredParticles) {
      ctx.moveTo(p.x + p.r, p.y);
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    }
    ctx.fillStyle = color;
    ctx.fill();
  }
  // 左上の控えめな反射で、単色の円ではなく細かな砂粒として見せる。
  ctx.beginPath();
  for (const p of particles) {
    const highlightRadius = Math.max(0.45, p.r * 0.28);
    ctx.moveTo(p.x - p.r * 0.28 + highlightRadius, p.y - p.r * 0.28);
    ctx.arc(p.x - p.r * 0.28, p.y - p.r * 0.28, highlightRadius, 0, Math.PI * 2);
  }
  ctx.fillStyle = "rgba(255, 244, 211, .28)";
  ctx.fill();
  ctx.restore();
  ctx.drawImage(front, 0, 0);
  ctx.restore();
}
