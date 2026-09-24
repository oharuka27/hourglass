const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const elements = {};
const sizeButtons = ['normal', 'fine'].map(size => ({
  dataset: { size },
  setAttribute(key, value) { this[key] = value; },
  addEventListener(event, callback) { this[event] = callback; },
}));
const document = {
  querySelectorAll: selector => selector === '[data-size]' ? sizeButtons : [],
  getElementById(id) {
    return elements[id] ||= {
      width: 520, height: 760, value: id === 'neckWidth' ? '28' : '500',
      getContext: () => new Proxy({}, {
        get: (_, key) => key === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {},
      }),
      addEventListener(event, callback) { this[event] = callback; },
    };
  },
};
// 固定シードで変更前後の測定と衝突の回帰検証を再現可能にする。
let seed = 42;
const math = Object.create(Math);
math.random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);
const source = fs.readFileSync(process.env.SIM_SOURCE || path.join(__dirname, '..', 'script.js'), 'utf8');
new Function('document', 'performance', 'requestAnimationFrame', 'assert', 'Math', source + `
  const hasSizeControl = typeof applyParticleSize === 'function';
  if (hasSizeControl) {
    for (const n of [300, 500, 1000]) {
      const normal = computeRadius(n, 'normal');
      const fine = computeRadius(n * 2, 'fine');
      assert.ok(Math.abs(fine * fine / (normal * normal) - .5) < 1e-10);
    }
    sizeButtons[1].click();
    assert.equal(particleSize, 'fine');
    assert.equal(particleCountInput.min, '600');
    assert.equal(particleCountInput.max, '2000');
    assert.equal(particleCountInput.step, '100');
    assert.equal(particleCountInput.value, '1000');
    assert.equal(neckWidthInput.min, '6');
    assert.equal(neckWidthInput.max, '40');
    assert.equal(neckWidthInput.step, '1');
    assert.equal(neckWidthInput.value, '14');
    assert.equal(NECK_HALF_WIDTH, 7);
    neckWidthInput.value = '6';
    neckWidthInput.input();
    assert.equal(NECK_HALF_WIDTH, 3);
    assert.equal(neckWidthValue.textContent, '6');
    neckWidthInput.value = '40';
    neckWidthInput.input();
    assert.equal(NECK_HALF_WIDTH, 20);
    assert.equal(neckWidthValue.textContent, '40');
    neckWidthInput.value = '14';
    neckWidthInput.input();
    assert.equal(particles.length, 1000);
    assert.equal(sizeButtons[1]['aria-pressed'], 'true');
    particleCountInput.value = '2000';
    resetBtn.click();
    assert.equal(particles.length, 2000);
    sizeButtons[0].click();
    assert.equal(particles.length, 1000);
    assert.equal(particleCountInput.value, '1000');
    assert.equal(particleCountInput.min, '300');
    assert.equal(particleCountInput.max, '1000');
    assert.equal(particleCountInput.step, '50');
    assert.equal(neckWidthInput.min, '12');
    assert.equal(neckWidthInput.max, '80');
    assert.equal(neckWidthInput.step, '2');
    assert.equal(neckWidthInput.value, '28');
    assert.equal(NECK_HALF_WIDTH, 14);
    sizeButtons[1].click();
    flipStarted = 10;
    sizeButtons[0].click();
    assert.equal(flipStarted, null);
    assert.equal(flipAngle, 0);
    sizeButtons[1].click();
  } else {
    // 変更前も同じ半径・個数で測定する。
    computeRadius = () => 4.5 * Math.SQRT1_2;
  }

  function checkGeometry(label) {
    assert.equal(particles.length, 2000);
    let maxOverlap = 0;
    let below = 0;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), label);
      assert.ok(p.y >= TOP_Y + p.r - .5 && p.y <= BOTTOM_Y - p.r + .5, label + ' vertical bounds');
      assert.ok(p.x >= leftBoundAt(p.y) + p.r - .5 && p.x <= rightBoundAt(p.y) - p.r + .5, label + ' side bounds');
      if (p.y > MID_Y) below++;
      for (let j = i + 1; j < particles.length; j++) {
        const q = particles[j];
        maxOverlap = Math.max(maxOverlap, 1 - Math.hypot(p.x - q.x, p.y - q.y) / (p.r + q.r));
      }
    }
    assert.ok(maxOverlap < .1, label + ' overlap ' + maxOverlap);
    assert.ok(below > 0, label + ' sand must pass the neck');
    console.log(label, 'max overlap', (maxOverlap * 100).toFixed(2) + '%');
  }
  for (const width of [12, 28, 80]) {
    NECK_HALF_WIDTH = width / 2;
    initParticles(2000);
    const timings = [];
    for (let frame = 0; frame < 240; frame++) {
      if (frame === 120) finishFlip();
      if (frame === 160) pointerRepulsion = { x: CENTER_X, y: MID_Y + 150 };
      if (frame === 180) pointerRepulsion = null;
      const start = performance.now();
      step(1 / 60);
      timings.push(performance.now() - start);
    }
    checkGeometry('2000 grains, neck ' + width);
    timings.sort((a, b) => a - b);
    console.log('physics ms/frame: median', timings[120].toFixed(2), 'p95', timings[228].toFixed(2));
  }
  neckWidthInput.value = '12';
  neckWidthInput.input();
  for (let i = 0; i < 120; i++) step(1 / 30);
  checkGeometry('2000 grains after narrowing, 30fps');
`)(document, performance, () => {}, assert, math);
