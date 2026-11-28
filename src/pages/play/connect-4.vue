<script setup lang="ts">
import { onBeforeUnmount, reactive, ref } from 'vue';

import GameControls from '@/components/GameControls.vue';
import GamePage from '@/components/GamePage.vue';
import { useGameKey } from '@/composables/useGameInput';

definePage({ meta: { title: 'Connect 4' } });

type Player = 1 | 2;
type Cell = [row: number, col: number];

const ROWS = 6;
const COLS = 7;
const CELL_SIZE = 62;
const GRAVITY = 0.006;
const BOUNCE = 0.25;
const EASE_IN = 'cubic-bezier(0.11, 0, 0.5, 0)';
const EASE_OUT = 'cubic-bezier(0.5, 1, 0.89, 1)';
const DIRECTIONS: Cell[] = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

const rowIndexes = Array.from({ length: ROWS }, (_, index) => index);
const colIndexes = Array.from({ length: COLS }, (_, index) => index);

const fallTime = (height: number) => Math.sqrt((2 * height) / GRAVITY);

function dropMotion(height: number) {
  const bounceHeight = height * BOUNCE ** 2;
  const fall = fallTime(height);
  const rise = fallTime(bounceHeight);
  const duration = fall + rise * 2;
  return {
    duration,
    keyframes: [
      { transform: `translateY(${-height}px)`, easing: EASE_IN },
      { transform: 'translateY(0)', offset: fall / duration, easing: EASE_OUT },
      {
        transform: `translateY(${-bounceHeight}px)`,
        offset: (fall + rise) / duration,
        easing: EASE_IN,
      },
      { transform: 'translateY(0)' },
    ],
  };
}

const createBoard = () =>
  Array.from({ length: ROWS }, () => Array.from({ length: COLS }, (): Player | null => null));

const status = ref<'playing' | 'over'>('playing');
const board = ref(createBoard());
const currentPlayer = ref<Player>(1);
const winner = ref<Player | null>(null);
const winningCells = ref<Cell[]>([]);
const hoveredCol = ref<number | null>(null);
const scores = reactive<Record<Player, number>>({ 1: 0, 2: 0 });
const droppingCell = ref<Cell | null>(null);
const isProcessing = ref(false);
const pieces = new Map<string, HTMLElement>();

let dropAnimation: Animation | undefined;

const valueAt = (row: number, col: number) => board.value[row]?.[col] ?? null;

function getGhostRow(col: number) {
  for (let row = ROWS - 1; row >= 0; row -= 1) {
    if (valueAt(row, col) === null) return row;
  }
  return null;
}

const isActive = () => status.value === 'playing' && !isProcessing.value;
const isGhostCell = (row: number, col: number) =>
  isActive() && hoveredCol.value === col && getGhostRow(col) === row;
const isSameCell = (cell: Cell | null, row: number, col: number) =>
  cell?.[0] === row && cell[1] === col;

function pieceClasses(row: number, col: number) {
  const value = valueAt(row, col);
  const isGhost = isGhostCell(row, col);
  return {
    p1: value === 1 || (isGhost && currentPlayer.value === 1),
    p2: value === 2 || (isGhost && currentPlayer.value === 2),
    ghost: isGhost,
    'winning-piece': winningCells.value.some((cell) => isSameCell(cell, row, col)),
    dropping: isSameCell(droppingCell.value, row, col),
  };
}

function trackPiece(row: number, col: number, element: unknown) {
  if (element instanceof HTMLElement) pieces.set(`${row}:${col}`, element);
}

function checkWinner(row: number, col: number) {
  const player = valueAt(row, col);

  const runFrom = (dr: number, dc: number) => {
    const cells: Cell[] = [];
    for (let r = row + dr, c = col + dc; valueAt(r, c) === player; r += dr, c += dc) {
      cells.push([r, c]);
    }
    return cells;
  };

  for (const [dr, dc] of DIRECTIONS) {
    const cells: Cell[] = [[row, col], ...runFrom(dr, dc), ...runFrom(-dr, -dc)];
    if (cells.length >= 4) return cells;
  }
  return null;
}

function makeMove(col: number) {
  if (!isActive()) return;

  const row = getGhostRow(col);
  const boardRow = row === null ? undefined : board.value[row];
  if (row === null || !boardRow) return;

  isProcessing.value = true;
  droppingCell.value = [row, col];
  boardRow[col] = currentPlayer.value;

  const win = checkWinner(row, col);
  if (win) {
    status.value = 'over';
    winner.value = currentPlayer.value;
    winningCells.value = win;
    scores[currentPlayer.value] += 1;
  } else if (board.value[0]?.every((cell) => cell !== null)) {
    status.value = 'over';
  } else {
    currentPlayer.value = currentPlayer.value === 1 ? 2 : 1;
  }

  const { keyframes, duration } = dropMotion(row * CELL_SIZE || 30);
  dropAnimation = pieces.get(`${row}:${col}`)?.animate(keyframes, duration);
  dropAnimation?.addEventListener('finish', () => {
    droppingCell.value = null;
    isProcessing.value = false;
  });
}

function resetGame() {
  dropAnimation?.cancel();
  status.value = 'playing';
  board.value = createBoard();
  currentPlayer.value = 1;
  winner.value = null;
  winningCells.value = [];
  droppingCell.value = null;
  isProcessing.value = false;
}

useGameKey(['r'], resetGame);

onBeforeUnmount(() => dropAnimation?.cancel());
</script>

<template>
  <GamePage>
    <div class="game-wrapper">
      <div class="left-section">
        <div class="board">
          <div
            v-for="col in colIndexes"
            :key="col"
            class="column"
            :class="{ hovered: hoveredCol === col && isActive() && getGhostRow(col) !== null }"
            @click="makeMove(col)"
            @mouseenter="hoveredCol = col"
            @mouseleave="hoveredCol = null"
          >
            <div v-for="row in rowIndexes" :key="row" class="cell">
              <div
                :ref="(element) => trackPiece(row, col, element)"
                class="piece"
                :class="pieceClasses(row, col)"
              ></div>
            </div>
          </div>
        </div>

        <div v-if="status === 'over' && !isProcessing" class="overlay-msg">
          <h2 class="menu-title">
            <span v-if="winner" class="player-text" :class="`p${winner}`">
              Player {{ winner }} Wins!
            </span>
            <span v-else>Draw!</span>
          </h2>
          <button class="overlay-btn" type="button" @click="resetGame">Play Again</button>
        </div>
      </div>

      <div class="right-section">
        <h1 class="game-title">Connect 4</h1>

        <div class="row">
          <div class="info-box score-box">
            <div class="label score-label player-text p1">Player 1</div>
            <div class="value score-value">{{ scores[1] }}</div>
          </div>
          <div class="info-box score-box">
            <div class="label score-label player-text p2">Player 2</div>
            <div class="value score-value">{{ scores[2] }}</div>
          </div>
        </div>

        <div class="row">
          <div class="info-box turn-box">
            <div class="label">Turn</div>
            <div class="value">
              <div
                v-if="status === 'playing'"
                class="turn-piece"
                :class="`p${currentPlayer}`"
              ></div>
              <span v-else>-</span>
            </div>
          </div>
        </div>

        <GameControls
          :controls="[
            { action: 'Drop Piece', keys: ['Click'] },
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
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.game-title {
  font-size: 48px;
}

.board {
  display: flex;
  gap: 8px;
  padding: 16px;
  background: #0d0d0d;
  border-radius: 12px;
}

.column {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.column.hovered {
  background: rgba(255, 255, 255, 0.04);
}

.cell {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 54px;
  height: 54px;
  overflow: visible;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.piece {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  transition:
    background-color 0.15s ease,
    box-shadow 0.15s ease;
}

.p1 {
  --player: #0dc2ff;
}

.p2 {
  --player: #ff0d72;
}

.player-text {
  color: var(--player);
}

.piece.p1,
.piece.p2,
.turn-piece {
  background: var(--player);
  box-shadow: 0 0 10px color-mix(in srgb, var(--player) 35%, transparent);
}

.piece.ghost {
  background: color-mix(in srgb, var(--player) 25%, transparent);
  box-shadow: 0 0 8px color-mix(in srgb, var(--player) 15%, transparent);
  pointer-events: none;
}

.piece.dropping {
  position: relative;
  z-index: 10;
}

.piece.winning-piece {
  animation: pulse 0.75s ease-in-out infinite alternate;
}

.info-box {
  flex: 1;
  aspect-ratio: 1;
}

.turn-box {
  aspect-ratio: auto;
  min-height: 60px;
  padding: 8px;
}

.turn-piece {
  width: 30px;
  height: 30px;
  border-radius: 50%;
}

@keyframes pulse {
  from {
    opacity: 1;
    transform: scale(1);
  }
  to {
    opacity: 0.55;
    transform: scale(0.88);
  }
}
</style>
