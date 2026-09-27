const assert = require('node:assert/strict');
const { installFakeDom, seedRandom } = require('./fake-dom.cjs');

(async () => {
  seedRandom(Number(process.env.PHYSICS_SEED || 42));
  const { $ } = installFakeDom();
  await import('../src/main.js');
  const geometry = await import('../src/geometry.js');
  const { CENTER_X, TOP_Y, MID_Y } = geometry;
  const {
    sim, Particle, resolvePair, step, initParticles, flipParticles, isParticleSupported, SLEEP_TIME_REQUIRED,
  } = await import('../src/physics.js');
  const { SAND_COLORS } = await import('../src/themes.js');
  const neckWidthInput = $('neckWidth');

  const a = new Particle(260, 600, 3, '#000');
  const b = new Particle(260, 600, 3, '#000');
  a.resting = b.resting = true;
  resolvePair(a, b);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 5.98,
    'Coincident sleeping particles must separate');

  const airborne = new Particle(CENTER_X, TOP_Y + 80, sim.particleRadius, '#000');
  sim.particles = [airborne];
  airborne.vx = airborne.vy = 0;
  airborne.resting = true;
  airborne.restTimer = SLEEP_TIME_REQUIRED;
  step(1 / 60);
  assert.equal(airborne.resting, false, 'An airborne particle must wake up');
  assert.ok(airborne.vy > 0, 'Gravity must keep acting on an airborne particle');

  airborne.y = MID_Y + 80;
  airborne.vx = airborne.vy = 0;
  airborne.resting = true;
  airborne.restTimer = SLEEP_TIME_REQUIRED;
  step(1 / 60);
  assert.equal(airborne.resting, false, 'An unsupported particle in the lower bulb must wake up');
  assert.ok(airborne.vy > 0, 'Gravity must act in the lower bulb too');
  initParticles(500, 'normal', SAND_COLORS.room);

  for (const width of [12, 80, 28]) {
    neckWidthInput.value = String(width);
    neckWidthInput.input();
    assert.equal(geometry.neckHalfWidth * 2, width);
    assert.equal($('neckWidthValue').textContent, String(width));
    for (let frame = 0; frame < 120; frame++) step(1 / 60);
    const { particles } = sim;
    assert.equal(particles.length, 500);
    assert.equal(particles.some(p => p.resting && !isParticleSupported(p)), false,
      'Only supported particles may remain asleep');
    let maxOverlap = 0;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
      for (let j = i + 1; j < particles.length; j++) {
        const q = particles[j];
        maxOverlap = Math.max(maxOverlap,
          1 - Math.hypot(p.x - q.x, p.y - q.y) / (p.r + q.r));
      }
    }
    assert.ok(maxOverlap < .1, 'Particle overlap must stay below 10% of diameter: ' + maxOverlap);
    flipParticles();
    console.log('PASS neck width', width, 'overlap', (maxOverlap * 100).toFixed(2) + '%');
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
