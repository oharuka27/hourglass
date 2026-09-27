// テーマごとの砂の色。背景とアクセント色は style.css の :root[data-theme] で切り替える。
export const SAND_COLORS = {
  room: ["#a97f49", "#ba9259", "#c9a66b", "#d6b982", "#e0c997"],
  sunset: ["#a97848", "#bb8955", "#c99c67", "#d8b47d", "#e2c694"],
  seaside: ["#a98654", "#bb9965", "#cbae78", "#d8bf8d", "#e3d0a5"],
  forest: ["#967747", "#a98a54", "#b99d68", "#c9b27d", "#d7c493"],
  night: ["#9b7c4d", "#ad8d58", "#bea16b", "#cdb57e", "#d8c693"],
};

export function pickColor(colors) {
  return colors[(Math.random() * colors.length) | 0];
}
