// src/main.js を Node で読み込むための最小限の DOM。
// addEventListener で登録した処理は element[イベント名] に入り、テストから直接呼べる。
function createElement(props = {}) {
  return {
    value: '',
    textContent: '',
    dataset: {},
    setAttribute(key, value) { this[key] = value; },
    addEventListener(event, callback) { this[event] = callback; },
    setPointerCapture() {},
    ...props,
  };
}

function createCanvasContext() {
  return new Proxy({}, {
    get: (_, key) => key === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {},
  });
}

// 固定シードの乱数にして、粒の配置と測定結果を再現できるようにする。
function seedRandom(initialSeed = 42) {
  let seed = initialSeed;
  Math.random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);
}

function installFakeDom() {
  const elements = {
    canvas: createElement({ width: 520, height: 760, getContext: createCanvasContext }),
    particleCount: createElement({ value: '500' }),
    neckWidth: createElement({ value: '28' }),
  };
  const sizeButtons = ['normal', 'fine'].map(size => createElement({ dataset: { size } }));
  const selected = {};
  globalThis.document = {
    documentElement: createElement(),
    getElementById: id => (elements[id] ||= createElement()),
    querySelector: selector => (selected[selector] ||= createElement()),
    querySelectorAll: selector => selector === '[data-size]' ? sizeButtons : [],
  };
  globalThis.document.createElement = () => createElement({ getContext: createCanvasContext });
  globalThis.Path2D = class { moveTo() {} lineTo() {} closePath() {} };
  globalThis.window = { matchMedia: () => ({ matches: false }) };
  globalThis.requestAnimationFrame = () => {};
  return { $: id => globalThis.document.getElementById(id), sizeButtons };
}

module.exports = { installFakeDom, seedRandom };
