<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core';
import { computed, onBeforeUnmount, reactive, ref, shallowRef, useTemplateRef } from 'vue';

import GameControls from '@/components/GameControls.vue';
import GamePage from '@/components/GamePage.vue';
import { useGameKey, usePause } from '@/composables/useGameInput';
import { readSave, writeSave } from '@/lib/storage';

definePage({ meta: { title: 'Minesweeper' } });

type Level = 'easy' | 'medium' | 'hard';

interface Point {
  x: number;
  y: number;
}

interface Cell extends Point {
  index: number;
  isMine: boolean;
  isRevealed: boolean;
  isFlagged: boolean;
  isExploded: boolean;
  isPressed: boolean;
  neighborCount: number;
  delay: number;
}

const REVEAL_STEP_MS = 24;
const CHAIN_MS = 1100;
const WAVE_MS = 900;
const RESULT_DELAY_MS = 700;

const DIFFICULTIES: Record<Level, { rows: number; cols: number; mines: number; size: number }> = {
  easy: { rows: 9, cols: 9, mines: 10, size: 38 },
  medium: { rows: 16, cols: 16, mines: 40, size: 28 },
  hard: { rows: 20, cols: 24, mines: 99, size: 25 },
};

const LEVELS: { level: Level; label: string }[] = [
  { level: 'easy', label: 'Easy' },
  { level: 'medium', label: 'Medium' },
  { level: 'hard', label: 'Hard' },
];

const NEIGHBORS = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
] as const;

const SHAKE = [
  { transform: 'translate(0, 0)' },
  { transform: 'translate(-9px, 4px)' },
  { transform: 'translate(8px, -5px)' },
  { transform: 'translate(-5px, -3px)' },
  { transform: 'translate(3px, 3px)' },
  { transform: 'translate(0, 0)' },
];

const WAVE = [
  { transform: 'scale(1)' },
  { transform: 'scale(0.84)', backgroundColor: 'rgba(46, 213, 115, 0.35)', offset: 0.35 },
  { transform: 'scale(1)' },
];

const range = (length: number) => Array.from({ length }, (_, index) => index);
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const bestKey = (level: Level) => `minesweeper-best-${level}`;

function formatTime(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

const board = useTemplateRef('board');
const status = ref<'start' | 'playing' | 'ending' | 'over'>('start');
const level = ref<Level>('medium');
const cells = shallowRef<Cell[]>([]);
const isWon = ref(false);
const isNewBest = ref(false);
const isPaused = ref(false);
const flagsPlaced = ref(0);
const best = ref(0);
const elapsed = ref(0);
const now = ref(0);
const isTiming = ref(false);
const cellElements = new Map<number, HTMLElement>();

let grid: Cell[][] = [];
let pressed: Cell[] = [];
let isFirstClick = true;
let safeLeft = 0;
let startedAt = 0;
let resultTimer: ReturnType<typeof setTimeout> | undefined;

const clock = useIntervalFn(() => (now.value = performance.now()), 250, { immediate: false });

const difficulty = computed(() => DIFFICULTIES[level.value]);
const canPlay = computed(() => status.value === 'playing' && !isPaused.value);
const time = computed(() =>
  isTiming.value ? elapsed.value + now.value - startedAt : elapsed.value,
);

function stateOf(cell: Cell) {
  if (cell.isExploded) return 'exploded';
  if (cell.isRevealed) return cell.isMine ? 'mine' : 'revealed';
  if (cell.isFlagged) return cell.isMine || status.value === 'playing' ? 'flag' : 'misflag';
  return 'hidden';
}

function countOf(cell: Cell) {
  return stateOf(cell) === 'revealed' && cell.neighborCount > 0 ? cell.neighborCount : undefined;
}

function trackCell(index: number, element: unknown) {
  if (element instanceof HTMLElement) cellElements.set(index, element);
}

function startTimer() {
  startedAt = performance.now();
  now.value = startedAt;
  isTiming.value = true;
  clock.resume();
}

function stopTimer() {
  if (!isTiming.value) return;
  clock.pause();
  elapsed.value += performance.now() - startedAt;
  isTiming.value = false;
}

function buildBoard() {
  const { rows, cols, mines } = difficulty.value;
  stopTimer();
  clearTimeout(resultTimer);

  grid = range(rows).map((y) =>
    range(cols).map((x) =>
      reactive({
        index: y * cols + x,
        x,
        y,
        isMine: false,
        isRevealed: false,
        isFlagged: false,
        isExploded: false,
        isPressed: false,
        neighborCount: 0,
        delay: 0,
      }),
    ),
  );
  cells.value = grid.flat();
  cellElements.clear();

  pressed = [];
  flagsPlaced.value = 0;
  safeLeft = rows * cols - mines;
  elapsed.value = 0;
  isFirstClick = true;
  isPaused.value = false;
  isWon.value = false;
  isNewBest.value = false;
  best.value = readSave(bestKey(level.value), 0);
}

function showStartScreen() {
  buildBoard();
  status.value = 'start';
}

function startGame(nextLevel: Level) {
  level.value = nextLevel;
  buildBoard();
  status.value = 'playing';
}

function restart() {
  if (status.value !== 'start') startGame(level.value);
}

function neighborsOf({ x, y }: Point) {
  return NEIGHBORS.flatMap(([dx, dy]) => grid[y + dy]?.[x + dx] ?? []);
}

function placeMines(origin: Point) {
  const candidates = cells.value.filter(
    (cell) => Math.abs(cell.x - origin.x) > 1 || Math.abs(cell.y - origin.y) > 1,
  );
  for (let i = 0; i < difficulty.value.mines; i += 1) {
    const j = i + Math.floor(Math.random() * (candidates.length - i));
    const candidate = candidates[j];
    if (!candidate) continue;
    candidates[j] = candidates[i] ?? candidate;
    candidates[i] = candidate;
    candidate.isMine = true;
  }
  for (const cell of cells.value) {
    cell.neighborCount = neighborsOf(cell).filter((neighbor) => neighbor.isMine).length;
  }
}

function flood(starts: Cell[]) {
  const revealed: [Cell, number][] = [];
  const queue: [Cell, number][] = starts.map((cell) => [cell, 0]);
  for (const [cell, depth] of queue) {
    if (cell.isRevealed || cell.isFlagged) continue;
    cell.isRevealed = true;
    revealed.push([cell, depth]);
    if (cell.isMine) continue;
    safeLeft -= 1;
    if (cell.neighborCount > 0) continue;
    for (const neighbor of neighborsOf(cell)) queue.push([neighbor, depth + 1]);
  }
  return revealed;
}

function open(starts: Cell[]) {
  const revealed = flood(starts);
  const last = revealed.at(-1);
  const origin = starts[0];
  if (!last || !origin) return;

  const hits = revealed.filter(([cell]) => cell.isMine).map(([cell]) => cell);
  for (const cell of hits) cell.isExploded = true;
  for (const [cell, depth] of revealed) cell.delay = depth * REVEAL_STEP_MS;

  const [firstHit] = hits;
  if (firstHit) lose(firstHit);
  else if (safeLeft === 0) win(origin, last[1] * REVEAL_STEP_MS);
}

function finish(won: boolean) {
  stopTimer();
  status.value = 'ending';
  isWon.value = won;
}

function showResult(delay: number) {
  resultTimer = setTimeout(() => {
    status.value = 'over';
  }, delay);
}

function lose(origin: Cell) {
  finish(false);
  const mines = cells.value.filter((cell) => cell.isMine && !cell.isRevealed && !cell.isFlagged);
  const farthest = Math.max(1, ...mines.map((cell) => distance(cell, origin)));

  for (const cell of mines) {
    cell.delay = (distance(cell, origin) / farthest) * CHAIN_MS;
    cell.isRevealed = true;
  }
  for (const cell of cells.value) {
    if (cell.isFlagged && !cell.isMine) cell.delay = CHAIN_MS;
  }

  board.value?.animate(SHAKE, { duration: 450, easing: 'ease-out' });
  showResult(CHAIN_MS + RESULT_DELAY_MS);
}

function win(origin: Point, startDelay: number) {
  finish(true);
  const farthest = Math.max(1, ...cells.value.map((cell) => distance(cell, origin)));

  for (const cell of cells.value) {
    const delay = startDelay + (distance(cell, origin) / farthest) * WAVE_MS;
    cellElements.get(cell.index)?.animate(WAVE, { duration: 500, delay, easing: 'ease-out' });
    if (!cell.isMine) continue;
    cell.isFlagged = true;
    cell.delay = delay;
  }
  flagsPlaced.value = difficulty.value.mines;

  isNewBest.value = !best.value || elapsed.value < best.value;
  if (isNewBest.value) {
    best.value = Math.round(elapsed.value);
    writeSave(bestKey(level.value), best.value);
  }

  showResult(startDelay + WAVE_MS + RESULT_DELAY_MS);
}

function reveal(cell: Cell) {
  if (cell.isFlagged) return;
  if (isFirstClick) {
    placeMines(cell);
    isFirstClick = false;
    startTimer();
  }
  open([cell]);
}

function chord(cell: Cell) {
  const neighbors = neighborsOf(cell);
  const flags = neighbors.filter((neighbor) => neighbor.isFlagged).length;
  if (cell.neighborCount === 0 || flags !== cell.neighborCount) return;
  open(neighbors.filter((neighbor) => !neighbor.isRevealed && !neighbor.isFlagged));
}

function toggleFlag(cell: Cell) {
  if (!canPlay.value || cell.isRevealed) return;
  cell.isFlagged = !cell.isFlagged;
  cell.delay = 0;
  flagsPlaced.value += cell.isFlagged ? 1 : -1;
}

function release() {
  for (const cell of pressed) cell.isPressed = false;
  pressed = [];
}

function press(event: PointerEvent, cell: Cell) {
  release();
  if (event.button !== 0 || !canPlay.value || !cell.isRevealed || cell.neighborCount === 0) return;
  pressed = neighborsOf(cell).filter((neighbor) => !neighbor.isRevealed && !neighbor.isFlagged);
  for (const neighbor of pressed) neighbor.isPressed = true;
}

function select(cell: Cell) {
  if (!canPlay.value) return;
  if (cell.isRevealed) chord(cell);
  else reveal(cell);
}

function togglePause() {
  if (status.value !== 'playing') return;
  isPaused.value = !isPaused.value;
  if (isPaused.value) stopTimer();
  else if (!isFirstClick) startTimer();
}

useGameKey(['r'], restart);
usePause(togglePause, () => isPaused.value);

showStartScreen();

onBeforeUnmount(() => clearTimeout(resultTimer));
</script>

<template>
  <GamePage>
    <div class="game-wrapper">
      <div class="left-section">
        <div ref="board" class="board">
          <div
            class="grid"
            :class="{ locked: !canPlay }"
            :style="{ '--cols': difficulty.cols, '--size': `${difficulty.size}px` }"
            @pointerup="release"
            @pointerleave="release"
          >
            <div
              v-for="cell in cells"
              :key="cell.index"
              :ref="(element) => trackCell(cell.index, element)"
              class="cell"
              :class="{ pressed: cell.isPressed }"
              :data-state="stateOf(cell)"
              :data-count="countOf(cell)"
              :style="{ '--delay': `${Math.round(cell.delay)}ms` }"
              @click="select(cell)"
              @contextmenu.prevent="toggleFlag(cell)"
              @pointerdown="press($event, cell)"
            >
              {{ countOf(cell) }}
            </div>
          </div>
        </div>

        <div v-if="status === 'start'" class="overlay-msg">
          <h2 class="menu-title">Minesweeper</h2>
          <div class="overlay-actions">
            <button
              v-for="option in LEVELS"
              :key="option.level"
              class="overlay-btn"
              type="button"
              @click="startGame(option.level)"
            >
              {{ option.label }}
            </button>
          </div>
        </div>

        <div v-else-if="status === 'over'" class="overlay-msg">
          <h2 class="menu-title outcome-title" :class="{ won: isWon }">
            {{ isWon ? 'You Win!' : 'Game Over' }}
          </h2>
          <p v-if="isWon" class="outcome-detail">
            {{ isNewBest ? 'New Best' : 'Time' }} · {{ formatTime(elapsed) }}
          </p>
          <div class="overlay-actions">
            <button class="overlay-btn" type="button" @click="restart">Play Again</button>
            <button class="overlay-btn" type="button" @click="showStartScreen">Change Level</button>
          </div>
        </div>

        <div v-else-if="isPaused" class="overlay-msg">
          <h2 class="menu-title">Paused</h2>
        </div>
      </div>

      <div class="right-section">
        <h1 class="game-title">Minesweeper</h1>

        <div class="info-box score-box">
          <div class="label mines-label">Mines Left</div>
          <div class="value mines-value">{{ difficulty.mines - flagsPlaced }}</div>

          <div class="score-divider"></div>

          <div class="stats">
            <div>
              <div class="label stat-label">Time</div>
              <div class="value stat-value">{{ formatTime(time) }}</div>
            </div>
            <div>
              <div class="label stat-label best-label">Best</div>
              <div class="value stat-value best-value">{{ best ? formatTime(best) : '—' }}</div>
            </div>
          </div>
        </div>

        <GameControls
          :controls="[
            { action: 'Reveal', keys: ['Click'] },
            { action: 'Flag', keys: ['Right Click'] },
            { action: 'Clear Around', keys: ['Click Number'] },
            { action: 'Pause', keys: ['Esc', 'P'] },
            { action: 'Restart', keys: ['R'] },
          ]"
        />
      </div>
    </div>
  </GamePage>
</template>

<style scoped>
.left-section {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 300px;
  min-height: 300px;
}

.game-title {
  font-size: 48px;
}

.outcome-title {
  color: #ff4757;
}

.outcome-title.won {
  color: #2ed573;
}

.outcome-title:has(+ .outcome-detail) {
  margin-bottom: 8px;
}

.outcome-detail {
  margin-bottom: 22px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: #ffd700;
}

.board {
  padding: 10px;
  background: #0d0d0d;
  border-radius: 10px;
}

.grid {
  --tile: #2a2e3b;
  --tile-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 2px 0 rgba(0, 0, 0, 0.5);
  --flag: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><rect x='5' y='3' width='2.6' height='18' rx='1.3'/><path d='M8 4h10.5a1 1 0 0 1 .8 1.6L16.5 9l2.8 3.4a1 1 0 0 1-.8 1.6H8z'/></svg>");
  --mine: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path fill-rule='evenodd' d='M12 5.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zm-2 3a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2z'/><path d='M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4M5.3 5.3l2.8 2.8M15.9 15.9l2.8 2.8M5.3 18.7l2.8-2.8M15.9 8.1l2.8-2.8' stroke='black' stroke-width='2.4' stroke-linecap='round'/></svg>");
  display: grid;
  grid-template-columns: repeat(var(--cols), var(--size));
  grid-auto-rows: var(--size);
  gap: 3px;
  cursor: pointer;
}

.grid:empty {
  width: 493px;
  height: 493px;
}

.grid.locked {
  pointer-events: none;
}

.cell {
  position: relative;
  display: grid;
  place-items: center;
  font-size: calc(var(--size) * 0.56);
  font-weight: 900;
  line-height: 1;
  background-color: var(--tile);
  border-radius: calc(var(--size) * 0.22);
  box-shadow: var(--tile-shadow);
  transition:
    transform 0.12s ease,
    background-color 0.12s ease;
}

.cell:is([data-state='hidden'], [data-state='flag']):hover {
  background-color: #363b4b;
}

.cell[data-state='hidden']:active,
.cell.pressed {
  background-color: #20232d;
  box-shadow: none;
  transform: scale(0.88);
}

.cell:is([data-state='revealed'], [data-state='mine'], [data-state='exploded']) {
  background-color: rgba(255, 255, 255, 0.035);
  box-shadow: none;
}

.cell[data-state='revealed'] {
  animation: reveal 0.35s cubic-bezier(0.16, 1, 0.3, 1) var(--delay) backwards;
}

.cell[data-count='1'] {
  color: #00a2ff;
}

.cell[data-count='2'] {
  color: #2ed573;
}

.cell[data-count='3'] {
  color: #ff4757;
}

.cell[data-count='4'] {
  color: #a55eea;
}

.cell[data-count='5'] {
  color: #ffa502;
}

.cell[data-count='6'] {
  color: #1dd1a1;
}

.cell[data-count='7'] {
  color: #ff6b81;
}

.cell[data-count='8'] {
  color: #94a3b8;
}

.cell:is(
    [data-state='flag'],
    [data-state='misflag'],
    [data-state='mine'],
    [data-state='exploded']
  )::before {
  content: '';
  position: absolute;
  inset: 20%;
  background: currentColor;
  mask: var(--icon) center / contain no-repeat;
}

.cell:is([data-state='flag'], [data-state='misflag'])::before {
  --icon: var(--flag);
}

.cell:is([data-state='mine'], [data-state='exploded'])::before {
  --icon: var(--mine);
}

.cell[data-state='flag'] {
  color: #ff4757;
}

.cell[data-state='flag']::before {
  animation: plant 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) var(--delay) backwards;
}

.cell[data-state='misflag'] {
  color: #4a5163;
}

.cell[data-state='misflag']::after {
  content: '';
  position: absolute;
  width: 80%;
  height: 2px;
  background: #ff4757;
  border-radius: 2px;
  transform: rotate(-45deg);
  animation: strike 0.25s ease-out var(--delay) backwards;
}

.cell[data-state='mine'] {
  color: #ff8a95;
  background-color: rgba(255, 71, 87, 0.14);
  animation: mine-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) var(--delay) backwards;
}

.cell[data-state='exploded'] {
  z-index: 1;
  color: #ffffff;
  background-color: #ff4757;
  box-shadow: 0 0 16px rgba(255, 71, 87, 0.6);
  animation: explode 0.7s cubic-bezier(0.16, 1, 0.3, 1);
}

.mines-label {
  margin-bottom: 4px;
  color: #ffd700;
}

.mines-value {
  color: #ffd700;
  font-size: 38px;
}

.score-divider {
  margin: 12px 0;
}

.stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  width: 100%;
  text-align: center;
}

.stat-label {
  margin-bottom: 4px;
}

.stat-value {
  color: #94a3b8;
  font-size: 24px;
}

.best-label,
.best-value {
  color: #ffd700;
}

@keyframes reveal {
  from {
    color: transparent;
    background-color: var(--tile);
    box-shadow: var(--tile-shadow);
  }
  40% {
    color: transparent;
    transform: scale(0.82);
  }
}

@keyframes plant {
  from {
    transform: translateY(40%) scale(0);
  }
}

@keyframes strike {
  from {
    transform: rotate(-45deg) scaleX(0);
  }
}

@keyframes mine-in {
  from {
    color: transparent;
    background-color: var(--tile);
    box-shadow: var(--tile-shadow);
    transform: scale(1);
  }
  50% {
    transform: scale(1.18);
  }
}

@keyframes explode {
  from {
    transform: scale(1.6);
    box-shadow:
      0 0 0 0 rgba(255, 71, 87, 0.9),
      0 0 16px rgba(255, 71, 87, 0.6);
  }
  to {
    box-shadow:
      0 0 0 calc(var(--size) * 1.4) rgba(255, 71, 87, 0),
      0 0 16px rgba(255, 71, 87, 0.6);
  }
}
</style>
