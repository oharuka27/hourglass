import { W, H, isInsideGlass, setNeckHalfWidth } from "./geometry.js";
import {
  sim, PARTICLE_SIZES, initParticles, step, isSettled, flipParticles, changeNeckHalfWidth,
} from "./physics.js";
import { SAND_COLORS, pickColor } from "./themes.js";
import { draw, groupParticlesByColor } from "./render.js";

// ------------------------------------------------------------------
// DOM
// ------------------------------------------------------------------
const canvas = document.getElementById("canvas");
canvas.width = W;
canvas.height = H;
const ctx = canvas.getContext("2d");
const particleCountInput = document.getElementById("particleCount");
const particleCountValue = document.getElementById("particleCountValue");
const neckWidthInput = document.getElementById("neckWidth");
const neckWidthValue = document.getElementById("neckWidthValue");
const particleActual = document.getElementById("particleActual");
const flipStatus = document.getElementById("flipStatus");
const fpsEl = document.getElementById("fps");
const resetBtn = document.getElementById("resetBtn");
const flipBtn = document.getElementById("flipBtn");
const hourglassBtn = document.getElementById("hourglassBtn");
const sizeButtons = document.querySelectorAll("[data-size]");
const themeButtons = document.querySelectorAll("[data-theme-button]");
const scene = document.querySelector(".scene");
const sceneArt = document.querySelector(".scene-art");

// ------------------------------------------------------------------
// 画面の状態
// ------------------------------------------------------------------
export const ui = {
  particleSize: "normal",
  activeTheme: "room",
  // 描画用に色ごとにまとめた粒（render.js の groupParticlesByColor）
  particlesByColor: new Map(),
  // 反転アニメーションの開始時刻（performance.now）と、描画に使う回転角
  flipStarted: null,
  flipAngle: 0,
  pointerTap: null,
  suppressNextFlipClick: false,
};

function render() {
  draw(ctx, sim.particles, ui.particlesByColor, ui.flipAngle);
}

function resetParticles(count) {
  initParticles(count, ui.particleSize, SAND_COLORS[ui.activeTheme]);
  ui.particlesByColor = groupParticlesByColor(sim.particles);
  particleActual.textContent = `配置粒子数: ${sim.particles.length} / 要求: ${count}`;
}

// ------------------------------------------------------------------
// メインループ / FPS計測
// ------------------------------------------------------------------
let lastTime = performance.now();
let fpsSmoothed = 60;

function loop(now) {
  let dt = (now - lastTime) / 1000;
  const frameDt = dt;
  lastTime = now;
  dt = Math.min(dt, 1 / 30); // タブ切り替え等での大ジャンプを防ぐ

  if (ui.flipStarted !== null) {
    const progress = Math.min(1, (now - ui.flipStarted) / 650);
    ui.flipAngle = Math.PI * progress * progress * (3 - 2 * progress);
    if (progress === 1) finishFlip();
    render();
  } else if (!isSettled()) {
    step(dt);
    render();
  }
  // 砂が落ち切って止まっている間は、計算も描画も休む（テーマ変更などは各処理が直接描き直す）。

  const instFps = frameDt > 0 ? 1 / frameDt : 60;
  fpsSmoothed += (instFps - fpsSmoothed) * 0.1;
  fpsEl.textContent = `FPS: ${fpsSmoothed.toFixed(0)}`;

  requestAnimationFrame(loop);
}

// ------------------------------------------------------------------
// 粒のサイズ・テーマ
// ------------------------------------------------------------------
function setRange(input, range, value) {
  input.min = String(range.min);
  input.max = String(range.max);
  input.step = String(range.step);
  input.value = String(Math.max(range.min, Math.min(range.max, value)));
}

function applyParticleSize(size) {
  if (!PARTICLE_SIZES[size] || size === ui.particleSize) return;
  const previous = PARTICLE_SIZES[ui.particleSize];
  const setting = PARTICLE_SIZES[size];
  const count = Number(particleCountInput.value) / previous.multiplier * setting.multiplier;
  const neckWidth = Number(neckWidthInput.value) / previous.neckScale * setting.neckScale;
  ui.particleSize = size;
  setRange(particleCountInput, setting.count, count);
  particleCountValue.textContent = particleCountInput.value;
  setRange(neckWidthInput, setting.neck, neckWidth);
  neckWidthValue.textContent = neckWidthInput.value;
  setNeckHalfWidth(Number(neckWidthInput.value) / 2);
  for (const button of sizeButtons) button.setAttribute("aria-pressed", String(button.dataset.size === size));
  if (ui.flipStarted !== null) finishFlip();
  sim.pointerRepulsion = null;
  resetParticles(Number(particleCountInput.value));
  render();
}
for (const button of sizeButtons) button.addEventListener("click", () => applyParticleSize(button.dataset.size));

function applyTheme(themeName) {
  ui.activeTheme = SAND_COLORS[themeName] ? themeName : "room";
  const colors = SAND_COLORS[ui.activeTheme];
  document.documentElement.setAttribute("data-theme", ui.activeTheme);
  for (const button of themeButtons) {
    const selected = button.dataset.themeButton === ui.activeTheme;
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  }
  for (const p of sim.particles) p.color = pickColor(colors);
  ui.particlesByColor = groupParticlesByColor(sim.particles);
  sceneArt.setAttribute("aria-hidden", ui.activeTheme === "room" ? "false" : "true");
  render();
}

for (const button of themeButtons) {
  button.addEventListener("click", event => {
    event.stopPropagation();
    applyTheme(button.dataset.themeButton);
  });
}

// ------------------------------------------------------------------
// ポインター操作（ガラスの中は砂をよける、外は反転）
// ------------------------------------------------------------------
function getCanvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * W / rect.width,
    y: (event.clientY - rect.top) * H / rect.height,
  };
}

function updatePointerRepulsion(event) {
  const point = getCanvasPoint(event);
  sim.pointerRepulsion = { ...point, pointerId: event.pointerId };
}

function stopPointerRepulsion(event) {
  if (!sim.pointerRepulsion || event.pointerId === sim.pointerRepulsion.pointerId) {
    sim.pointerRepulsion = null;
  }
}

function finishPointerTap(event) {
  if (ui.pointerTap?.pointerId === event.pointerId) {
    ui.pointerTap.releasedInside = isInsideGlass(getCanvasPoint(event));
    if (ui.pointerTap.releasedInside) ui.suppressNextFlipClick = true;
  }
  stopPointerRepulsion(event);
}

hourglassBtn.addEventListener("pointerdown", event => {
  const point = getCanvasPoint(event);
  ui.pointerTap = { pointerId: event.pointerId, insideGlass: isInsideGlass(point) };
  ui.suppressNextFlipClick = ui.pointerTap.insideGlass;
  if (ui.pointerTap.insideGlass) updatePointerRepulsion(event);
  hourglassBtn.setPointerCapture(event.pointerId);
});
hourglassBtn.addEventListener("pointermove", event => {
  if (ui.pointerTap?.insideGlass && ui.pointerTap.pointerId === event.pointerId) {
    updatePointerRepulsion(event);
  }
});
hourglassBtn.addEventListener("pointerup", finishPointerTap);
hourglassBtn.addEventListener("pointercancel", event => {
  stopPointerRepulsion(event);
  ui.pointerTap = null;
  ui.suppressNextFlipClick = false;
});
hourglassBtn.addEventListener("lostpointercapture", event => {
  stopPointerRepulsion(event);
});

// ------------------------------------------------------------------
// スライダー・ボタン
// ------------------------------------------------------------------
neckWidthInput.addEventListener("input", () => {
  changeNeckHalfWidth(Number(neckWidthInput.value) / 2);
  neckWidthValue.textContent = neckWidthInput.value;
  render();
});

particleCountInput.addEventListener("input", () => {
  particleCountValue.textContent = particleCountInput.value;
});

resetBtn.addEventListener("click", () => {
  if (ui.flipStarted !== null) finishFlip();
  resetParticles(parseInt(particleCountInput.value, 10));
});

function finishFlip() {
  flipParticles();
  ui.flipStarted = null;
  ui.flipAngle = 0;
  flipStatus.textContent = "砂時計の上下を入れ替えました";
}

function flipHourglass() {
  if (ui.flipStarted !== null) return;
  flipStatus.textContent = "";
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    finishFlip();
  } else {
    ui.flipStarted = performance.now();
  }
}
flipBtn.addEventListener("click", flipHourglass);
hourglassBtn.addEventListener("click", event => {
  if (ui.suppressNextFlipClick || ui.pointerTap?.insideGlass || ui.pointerTap?.releasedInside) {
    event.preventDefault();
    ui.pointerTap = null;
    ui.suppressNextFlipClick = false;
    return;
  }
  ui.pointerTap = null;
  ui.suppressNextFlipClick = false;
  flipHourglass();
});
scene.addEventListener("click", event => {
  if (event.target.closest("#hourglassBtn")) return;
  flipHourglass();
});

// ------------------------------------------------------------------
// 起動
// ------------------------------------------------------------------
applyTheme("room");
resetParticles(parseInt(particleCountInput.value, 10));
requestAnimationFrame(loop);
