const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { installFakeDom, seedRandom } = require('./fake-dom.cjs');

(async () => {
  // 固定シードで性能測定と衝突の回帰検証を再現可能にする。
  seedRandom(42);
  const { $, sizeButtons } = installFakeDom();
  const { ui } = await import('../src/main.js');
  const geometry = await import('../src/geometry.js');
  const { TOP_Y, BOTTOM_Y, CENTER_X, MID_Y, leftBoundAt, rightBoundAt, setNeckHalfWidth } = geometry;
  const { sim, computeRadius, initParticles, step, flipParticles } = await import('../src/physics.js');
  const { SAND_COLORS } = await import('../src/themes.js');
  const particleCountInput = $('particleCount');
  const neckWidthInput = $('neckWidth');
  const neckWidthValue = $('neckWidthValue');

  // 「細かい」は1粒の面積が「ふつう」の半分になる。
  const normalRadius = computeRadius('normal');
  const fineRadius = computeRadius('fine');
  assert.equal(normalRadius, 4.5);
  assert.ok(Math.abs(fineRadius * fineRadius / (normalRadius * normalRadius) - .5) < 1e-10);
  sizeButtons[1].click();
  assert.equal(ui.particleSize, 'fine');
  assert.equal(particleCountInput.min, '600');
  assert.equal(particleCountInput.max, '2000');
  assert.equal(particleCountInput.step, '100');
  assert.equal(particleCountInput.value, '1000');
  assert.equal(neckWidthInput.min, '6');
  assert.equal(neckWidthInput.max, '40');
  assert.equal(neckWidthInput.step, '1');
  assert.equal(neckWidthInput.value, '14');
  assert.equal(geometry.neckHalfWidth, 7);
  neckWidthInput.value = '6';
  neckWidthInput.input();
  assert.equal(geometry.neckHalfWidth, 3);
  assert.equal(neckWidthValue.textContent, '6');
  neckWidthInput.value = '40';
  neckWidthInput.input();
  assert.equal(geometry.neckHalfWidth, 20);
  assert.equal(neckWidthValue.textContent, '40');
  neckWidthInput.value = '14';
  neckWidthInput.input();
  assert.equal(sim.particles.length, 1000);
  assert.equal(sizeButtons[1]['aria-pressed'], 'true');
  particleCountInput.value = '2000';
  $('resetBtn').click();
  assert.equal(sim.particles.length, 2000);
  sizeButtons[0].click();
  assert.equal(sim.particles.length, 1000);
  assert.equal(particleCountInput.value, '1000');
  assert.equal(particleCountInput.min, '300');
  assert.equal(particleCountInput.max, '1000');
  assert.equal(particleCountInput.step, '50');
  assert.equal(neckWidthInput.min, '12');
  assert.equal(neckWidthInput.max, '80');
  assert.equal(neckWidthInput.step, '2');
  assert.equal(neckWidthInput.value, '28');
  assert.equal(geometry.neckHalfWidth, 14);
  sizeButtons[1].click();
  ui.flipStarted = 10;
  sizeButtons[0].click();
  assert.equal(ui.flipStarted, null);
  assert.equal(ui.flipAngle, 0);
  sizeButtons[1].click();

  function checkGeometry(label) {
    const { particles } = sim;
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
    setNeckHalfWidth(width / 2);
    initParticles(2000, ui.particleSize, SAND_COLORS[ui.activeTheme]);
    const timings = [];
    for (let frame = 0; frame < 240; frame++) {
      if (frame === 120) flipParticles();
      if (frame === 160) sim.pointerRepulsion = { x: CENTER_X, y: MID_Y + 150 };
      if (frame === 180) sim.pointerRepulsion = null;
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
})().catch(error => {
  console.error(error);
  process.exit(1);
});
