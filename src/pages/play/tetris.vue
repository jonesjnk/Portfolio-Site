<script setup lang="ts">
import { useRafFn } from '@vueuse/core';
import { onMounted, ref, useTemplateRef } from 'vue';

import GameControls from '@/components/GameControls.vue';
import GamePage from '@/components/GamePage.vue';
import { useGameKey, useHeldKeys, usePause } from '@/composables/useGameInput';
import { setupCanvas } from '@/lib/canvas';
import { readSave, writeSave } from '@/lib/storage';

definePage({ meta: { title: 'Tetris' } });

type PieceType = 'I' | 'J' | 'L' | 'O' | 'S' | 'Z' | 'T';
type Matrix = number[][];
type Kick = [x: number, y: number];
type HeldAction = 'left' | 'right' | 'softDrop';

interface Point {
  x: number;
  y: number;
}

interface Trail extends Point {
  h: number;
}

const BLOCK_SIZE = 25;
const ARENA_WIDTH = 12;
const ARENA_HEIGHT = 20;
const COLORS = ['', '#0dc2ff', '#3877ff', '#ff8e0d', '#ffe138', '#0dff72', '#ff0d72', '#f538ff'];
const LOCK_DELAY_MS = 500;
const MAX_LOCK_MOVES = 15;
const SHIFT_DELAY_MS = 170;
const SHIFT_REPEAT_MS = 33;
const SOFT_DROP_REPEAT_MS = 30;
const LINE_SCORES = [0, 100, 300, 500, 800];
const HIGH_SCORE_KEY = 'tetris-best-score';

const GRAVITY_BY_LEVEL = [
  0, 0.01667, 0.021017, 0.026977, 0.035256, 0.04693, 0.06361, 0.0879, 0.1236, 0.1775, 0.2598, 0.388,
  0.59, 0.92, 1.46, 2.36, 3.91, 6.61, 11.43, 20,
];

const PIECES: Record<PieceType, Matrix> = {
  I: [
    [0, 0, 0, 0],
    [1, 1, 1, 1],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ],
  J: [
    [2, 0, 0],
    [2, 2, 2],
    [0, 0, 0],
  ],
  L: [
    [0, 0, 3],
    [3, 3, 3],
    [0, 0, 0],
  ],
  O: [
    [4, 4],
    [4, 4],
  ],
  S: [
    [0, 5, 5],
    [5, 5, 0],
    [0, 0, 0],
  ],
  Z: [
    [6, 6, 0],
    [0, 6, 6],
    [0, 0, 0],
  ],
  T: [
    [0, 7, 0],
    [7, 7, 7],
    [0, 0, 0],
  ],
};

const PIECE_TYPES: (PieceType | null)[] = [null, 'I', 'J', 'L', 'O', 'S', 'Z', 'T'];

const KICKS_JLSTZ: Kick[][] = [
  [
    [0, 0],
    [-1, 0],
    [-1, -1],
    [0, 2],
    [-1, 2],
  ],
  [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, -2],
    [1, -2],
  ],
  [
    [0, 0],
    [1, 0],
    [1, -1],
    [0, 2],
    [1, 2],
  ],
  [
    [0, 0],
    [-1, 0],
    [-1, 1],
    [0, -2],
    [-1, -2],
  ],
];

const KICKS_I: Kick[][] = [
  [
    [0, 0],
    [-2, 0],
    [1, 0],
    [-2, 1],
    [1, -2],
  ],
  [
    [0, 0],
    [-1, 0],
    [2, 0],
    [-1, -2],
    [2, 1],
  ],
  [
    [0, 0],
    [2, 0],
    [-1, 0],
    [2, -1],
    [-1, 2],
  ],
  [
    [0, 0],
    [1, 0],
    [-2, 0],
    [1, 2],
    [-2, -1],
  ],
];

const HELD_KEYS: Record<HeldAction, string[]> = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  softDrop: ['ArrowDown', 'KeyS'],
};

const createRow = () => Array.from({ length: ARENA_WIDTH }, () => 0);
const createArena = () => Array.from({ length: ARENA_HEIGHT }, createRow);
const createPiece = (type: PieceType) => structuredClone(PIECES[type]);

function getPieceType(matrix: Matrix) {
  const value = matrix.flat().find((cell) => cell !== 0) ?? 0;
  return PIECE_TYPES[value] ?? null;
}

function rotate(matrix: Matrix, dir: number): Matrix {
  const last = matrix.length - 1;
  return matrix.map((row, y) =>
    row.map((_, x) => (dir > 0 ? matrix[last - x]?.[y] : matrix[x]?.[last - y]) ?? 0),
  );
}

const canvas = useTemplateRef('canvas');
const nextCanvas = useTemplateRef('nextCanvas');
const holdCanvas = useTemplateRef('holdCanvas');
const status = ref<'playing' | 'over'>('playing');
const isPaused = ref(false);
const score = ref(0);
const highScore = ref(readSave(HIGH_SCORE_KEY, 0));

let ctx: CanvasRenderingContext2D;
let nextCtx: CanvasRenderingContext2D;
let holdCtx: CanvasRenderingContext2D;
let arena = createArena();
let animationTime = 0;
let dropCounter = 0;
let dropInterval = 1000;
let lockDelayCounter = 0;
let lockMovesCounter = 0;
let isLanded = false;
let hardDropEffect: { alpha: number; trails: Trail[] } = { alpha: 0, trails: [] };
let piecesBag: PieceType[] = [];

const player = {
  pos: { x: 0, y: 0 },
  matrix: [] as Matrix,
  lines: 0,
  next: null as Matrix | null,
  hold: null as PieceType | null,
  canHold: true,
  rotation: 0,
};
const timers: Record<HeldAction, number> = { left: 0, right: 0, softDrop: 0 };
const wasHeld: Record<HeldAction, boolean> = { left: false, right: false, softDrop: false };
const heldActions: Record<HeldAction, () => void> = {
  left: () => playerMove(-1),
  right: () => playerMove(1),
  softDrop,
};

const loop = useRafFn(({ delta }) => update(delta), { immediate: false });
const keys = useHeldKeys(['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'Space'], () => {
  for (const action of ['left', 'right', 'softDrop'] as const) {
    const down = isHeld(action);
    if (down === wasHeld[action]) continue;
    wasHeld[action] = down;
    timers[action] = 0;
    if (down && isPlaying()) heldActions[action]();
  }
});

const isHeld = (action: HeldAction) => !keys.isModifierDown() && keys.isDown(...HELD_KEYS[action]);
const isPlaying = () => status.value === 'playing' && !isPaused.value;

function getNextPiece() {
  if (piecesBag.length === 0) {
    const pool = PIECE_TYPES.filter((type) => type !== null);
    piecesBag = Array.from({ length: pool.length }, () =>
      pool.splice(Math.floor(Math.random() * pool.length), 1),
    ).flat();
  }
  return createPiece(piecesBag.pop() ?? 'T');
}

function collide(matrix: Matrix, pos: Point) {
  return matrix.some((row, y) =>
    row.some((value, x) => value !== 0 && arena[y + pos.y]?.[x + pos.x] !== 0),
  );
}

function getGhostY() {
  let { y } = player.pos;
  while (!collide(player.matrix, { x: player.pos.x, y })) y += 1;
  return y - 1;
}

function drawBlock(target: CanvasRenderingContext2D, value: number, bx: number, by: number) {
  target.fillStyle = COLORS[value] ?? '';
  target.fillRect(bx, by, 1, 1);
}

function drawBevel(target: CanvasRenderingContext2D, bx: number, by: number) {
  target.fillStyle = 'rgba(255, 255, 255, 0.4)';
  target.fillRect(bx, by, 1, 0.15);
  target.fillRect(bx, by, 0.15, 1);
  target.fillStyle = 'rgba(0, 0, 0, 0.4)';
  target.fillRect(bx, by + 0.85, 1, 0.15);
  target.fillRect(bx + 0.85, by, 0.15, 1);
  target.fillStyle = 'rgba(0, 0, 0, 0.1)';
  target.fillRect(bx + 0.2, by + 0.2, 0.6, 0.6);
}

function drawMatrix(
  matrix: Matrix,
  offset: Point,
  target: CanvasRenderingContext2D,
  isGhost = false,
) {
  for (const [y, row] of matrix.entries()) {
    for (const [x, value] of row.entries()) {
      if (value === 0) continue;

      const bx = x + offset.x;
      const by = y + offset.y;

      if (isGhost) {
        target.fillStyle = 'rgba(255, 255, 255, 0.1)';
        target.fillRect(bx, by, 1, 1);
        continue;
      }

      drawBlock(target, value, bx, by);

      if (isLanded && target === ctx && matrix === player.matrix) {
        const alpha = 0.3 + 0.3 * Math.sin(animationTime * 0.0048);
        target.fillStyle = `rgba(0, 0, 0, ${alpha})`;
        target.fillRect(bx, by, 1, 1);
      }

      drawBevel(target, bx, by);
    }
  }
}

function drawPreview(target: CanvasRenderingContext2D, matrix: Matrix | null) {
  target.clearRect(0, 0, 4, 4);
  if (!matrix) return;
  const offset = (4 - matrix.length) / 2;
  drawMatrix(matrix, { x: offset, y: offset }, target);
}

function drawHardDropTrails() {
  for (const trail of hardDropEffect.trails) {
    const gradient = ctx.createLinearGradient(0, trail.y, 0, trail.y + trail.h);
    const fadeStop = trail.h > 0 ? Math.min(3, trail.h) / trail.h : 0;

    gradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
    if (fadeStop > 0 && fadeStop < 1) {
      gradient.addColorStop(fadeStop, `rgba(255, 255, 255, ${hardDropEffect.alpha})`);
    }
    gradient.addColorStop(1, `rgba(255, 255, 255, ${hardDropEffect.alpha})`);

    ctx.fillStyle = gradient;
    ctx.fillRect(trail.x, trail.y, 1, trail.h);
  }
}

function draw() {
  ctx.fillStyle = '#0d0d0d';
  ctx.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);

  if (hardDropEffect.alpha > 0) drawHardDropTrails();

  drawMatrix(arena, { x: 0, y: 0 }, ctx);
  drawMatrix(player.matrix, { x: player.pos.x, y: getGhostY() }, ctx, true);
  drawMatrix(player.matrix, player.pos, ctx);
}

function updateScore() {
  if (score.value > highScore.value) {
    highScore.value = score.value;
    writeSave(HIGH_SCORE_KEY, highScore.value);
  }
  const level = Math.min(Math.floor(player.lines / 10) + 1, GRAVITY_BY_LEVEL.length - 1);
  dropInterval = 1000 / (60 * (GRAVITY_BY_LEVEL[level] ?? 1));
}

function arenaSweep() {
  const remaining = arena.filter((row) => row.includes(0));
  const rowCount = ARENA_HEIGHT - remaining.length;
  arena = [...Array.from({ length: rowCount }, createRow), ...remaining];

  const level = Math.floor(player.lines / 10) + 1;
  score.value += (LINE_SCORES[rowCount] ?? 0) * level;
  player.lines += rowCount;
}

function merge() {
  for (const [y, row] of player.matrix.entries()) {
    const arenaRow = arena[y + player.pos.y];
    if (!arenaRow) continue;
    for (const [x, value] of row.entries()) {
      if (value !== 0) arenaRow[x + player.pos.x] = value;
    }
  }
}

function centerPiece() {
  player.pos.y = 0;
  player.pos.x = Math.floor(ARENA_WIDTH / 2) - Math.floor(player.matrix.length / 2);
  player.rotation = 0;
}

function playerReset() {
  player.matrix = player.next ?? getNextPiece();
  player.next = getNextPiece();
  drawPreview(nextCtx, player.next);
  centerPiece();
  if (collide(player.matrix, player.pos)) {
    status.value = 'over';
    loop.pause();
  }
}

function playerLock() {
  merge();
  arenaSweep();
  updateScore();
  playerReset();
  player.canHold = true;
  dropCounter = 0;
  lockDelayCounter = 0;
  lockMovesCounter = 0;
}

function playerDrop() {
  player.pos.y += 1;
  if (collide(player.matrix, player.pos)) {
    player.pos.y -= 1;
    return false;
  }
  dropCounter = 0;
  lockDelayCounter = 0;
  lockMovesCounter = 0;
  return true;
}

function refreshLockDelay() {
  const isResting = collide(player.matrix, { x: player.pos.x, y: player.pos.y + 1 });
  if (isResting && lockMovesCounter < MAX_LOCK_MOVES) {
    lockDelayCounter = 0;
    lockMovesCounter += 1;
  }
}

function playerMove(dir: number) {
  player.pos.x += dir;
  if (collide(player.matrix, player.pos)) {
    player.pos.x -= dir;
    return;
  }
  refreshLockDelay();
}

function playerRotate(dir: number) {
  if (player.matrix.length === 2) return;

  const nextState = (player.rotation + (dir > 0 ? 1 : -1) + 4) % 4;
  const table = player.matrix.length === 4 ? KICKS_I : KICKS_JLSTZ;
  const kicks =
    (dir > 0 ? table[player.rotation] : table[nextState]?.map(([kx, ky]): Kick => [-kx, -ky])) ??
    [];
  const rotated = rotate(player.matrix, dir);

  for (const [kx, ky] of kicks) {
    const pos = { x: player.pos.x + kx, y: player.pos.y + ky };
    if (collide(rotated, pos)) continue;
    player.matrix = rotated;
    player.pos = pos;
    player.rotation = nextState;
    refreshLockDelay();
    return;
  }
}

function playerHardDrop() {
  const startY = player.pos.y;
  const ghostY = getGhostY();
  const trails: Trail[] = [];

  for (let x = 0; x < player.matrix.length; x += 1) {
    const topY = player.matrix.findIndex((row) => row[x] !== 0);
    if (topY !== -1) trails.push({ x: player.pos.x + x, y: startY + topY, h: ghostY - startY });
  }

  score.value += (ghostY - startY) * 2;
  player.pos.y = ghostY;
  hardDropEffect = { alpha: 0.4, trails };
  playerLock();
}

function playerHold() {
  if (!player.canHold) return;

  const currentType = getPieceType(player.matrix);
  if (player.hold === null) {
    player.matrix = player.next ?? getNextPiece();
    player.next = getNextPiece();
    drawPreview(nextCtx, player.next);
  } else {
    player.matrix = createPiece(player.hold);
  }
  player.hold = currentType;
  drawPreview(holdCtx, currentType && createPiece(currentType));
  centerPiece();
  player.canHold = false;
}

function softDrop() {
  if (!playerDrop()) return;
  score.value += 1;
  updateScore();
}

function handleHorizontalInput(action: 'left' | 'right', direction: number, deltaTime: number) {
  if (!isHeld(action)) return;
  timers[action] += deltaTime;
  while (timers[action] > SHIFT_DELAY_MS + SHIFT_REPEAT_MS) {
    playerMove(direction);
    timers[action] -= SHIFT_REPEAT_MS;
  }
}

function handleSoftDrop(deltaTime: number) {
  if (!isHeld('softDrop')) return;
  timers.softDrop += deltaTime;
  while (timers.softDrop > SOFT_DROP_REPEAT_MS) {
    softDrop();
    timers.softDrop -= SOFT_DROP_REPEAT_MS;
  }
}

function handleGravityDrop(deltaTime: number) {
  dropCounter += deltaTime;
  if (dropCounter <= dropInterval) return;
  playerDrop();
  dropCounter = 0;
}

function checkCollisionAndLand(deltaTime: number) {
  isLanded = collide(player.matrix, { x: player.pos.x, y: player.pos.y + 1 });
  if (!isLanded) {
    lockDelayCounter = 0;
    return;
  }
  lockDelayCounter += deltaTime;
  if (lockDelayCounter > LOCK_DELAY_MS) playerLock();
}

function update(deltaTime: number) {
  animationTime += deltaTime;
  hardDropEffect.alpha = Math.max(0, hardDropEffect.alpha - deltaTime * 0.0048);

  handleHorizontalInput('left', -1, deltaTime);
  handleHorizontalInput('right', 1, deltaTime);
  handleSoftDrop(deltaTime);
  handleGravityDrop(deltaTime);
  checkCollisionAndLand(deltaTime);

  draw();
}

function togglePause() {
  if (status.value !== 'playing') return;
  isPaused.value = !isPaused.value;
  if (isPaused.value) loop.pause();
  else loop.resume();
}

function resetGame() {
  loop.pause();
  animationTime = 0;
  arena = createArena();
  score.value = 0;
  player.lines = 0;
  player.hold = null;
  player.next = null;
  player.canHold = true;
  dropCounter = 0;
  dropInterval = 1000;
  lockDelayCounter = 0;
  lockMovesCounter = 0;
  isLanded = false;
  hardDropEffect = { alpha: 0, trails: [] };
  timers.left = 0;
  timers.right = 0;
  timers.softDrop = 0;

  drawPreview(holdCtx, null);
  updateScore();
  status.value = 'playing';
  isPaused.value = false;
  playerReset();
  draw();
  loop.resume();
}

const whenPlaying = (action: () => void) => () => {
  if (isPlaying()) action();
};

useGameKey(
  ['ArrowUp', 'w'],
  whenPlaying(() => playerRotate(1)),
);
useGameKey([' '], whenPlaying(playerHardDrop));
useGameKey(['c'], whenPlaying(playerHold));
usePause(togglePause, () => isPaused.value);

onMounted(() => {
  if (!canvas.value || !nextCanvas.value || !holdCanvas.value) return;
  ctx = setupCanvas(canvas.value, 300, 500, BLOCK_SIZE);
  nextCtx = setupCanvas(nextCanvas.value, 100, 100, BLOCK_SIZE);
  holdCtx = setupCanvas(holdCanvas.value, 100, 100, BLOCK_SIZE);
  resetGame();
});
</script>

<template>
  <GamePage>
    <div class="game-wrapper">
      <div class="left-section">
        <canvas ref="canvas" class="game-canvas"></canvas>
        <div v-if="status === 'over'" class="overlay-msg">
          <h2 class="menu-title">Game Over</h2>
          <button class="overlay-btn" type="button" @click="resetGame">Play Again</button>
        </div>
        <div v-else-if="isPaused" class="overlay-msg">
          <h2 class="menu-title">Paused</h2>
        </div>
      </div>

      <div class="right-section">
        <h1 class="game-title">Tetris</h1>
        <div class="row">
          <div class="info-box">
            <div class="label">Next</div>
            <canvas ref="nextCanvas" class="preview-canvas"></canvas>
          </div>
          <div class="info-box">
            <div class="label">Hold</div>
            <canvas ref="holdCanvas" class="preview-canvas"></canvas>
          </div>
        </div>
        <div class="info-box score-box">
          <div class="label score-label">Score</div>
          <div class="value score-value">{{ score }}</div>
          <div class="score-divider"></div>
          <div class="label high-score-label">High Score</div>
          <div class="value high-score-value">{{ highScore }}</div>
        </div>
        <GameControls
          :controls="[
            { action: 'Move', keys: ['←', '↓', '→'] },
            { action: 'Rotate', keys: ['↑'] },
            { action: 'Alternative', keys: ['A', 'S', 'D', 'W'] },
            { action: 'Hard Drop', keys: ['Space'] },
            { action: 'Hold', keys: ['C'] },
            { action: 'Pause', keys: ['Esc', 'P'] },
          ]"
        />
      </div>
    </div>
  </GamePage>
</template>

<style scoped>
.info-box {
  flex: 1;
  aspect-ratio: 1;
}

.score-box {
  aspect-ratio: auto;
}

.game-canvas {
  width: 300px;
  height: 500px;
  background: #0d0d0d;
}

.preview-canvas {
  width: 100px;
  height: 100px;
}
</style>
