export function setupCanvas(canvas: HTMLCanvasElement, width: number, height: number, scale = 1) {
  const ratio = window.devicePixelRatio;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not supported.');
  ctx.scale(scale * ratio, scale * ratio);
  return ctx;
}
