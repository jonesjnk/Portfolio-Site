import { defineElement, onGameKey, onPause, readNumber, writeNumber } from '../game';

const REVEAL_STEP_MS = 24;
const CHAIN_MS = 1100;
const WAVE_MS = 900;
const RESULT_DELAY_MS = 700;

const DIFFICULTIES = {
  easy: { rows: 9, cols: 9, mines: 10, size: 38 },
  medium: { rows: 16, cols: 16, mines: 40, size: 28 },
  hard: { rows: 20, cols: 24, mines: 99, size: 25 },
};

const NEIGHBORS = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

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

function range(length) {
  return Array.from({ length }, (_, index) => index);
}

function formatTime(ms) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function bestKey(level) {
  return `minesweeper-best-${level}`;
}

defineElement('game-minesweeper', (root) => {
  const board = root.querySelector('.board');
  const gridEl = root.querySelector('.grid');
  const cellTemplate = root.querySelector('template[data-cell]');
  const startOverlay = root.querySelector('[data-start]');
  const overOverlay = root.querySelector('[data-over]');
  const pausedOverlay = root.querySelector('[data-paused]');
  const outcomeTitle = root.querySelector('[data-outcome]');
  const outcomeDetail = root.querySelector('[data-detail]');
  const minesText = root.querySelector('[data-mines]');
  const timeText = root.querySelector('[data-time]');
  const bestText = root.querySelector('[data-best]');

  let status = 'start';
  let level = 'medium';
  let isWon = false;
  let isNewBest = false;
  let isPaused = false;
  let isFirstClick = true;
  let grid = [];
  let cells = [];
  let pressed = [];
  let flagsPlaced = 0;
  let safeLeft = 0;
  let best = 0;
  let elapsed = 0;
  let startedAt = 0;
  let timerId;
  let resultTimer;

  const difficulty = () => DIFFICULTIES[level];
  const canPlay = () => status === 'playing' && !isPaused;
  const currentTime = () => (timerId ? elapsed + performance.now() - startedAt : elapsed);

  function startTimer() {
    startedAt = performance.now();
    timerId = setInterval(render, 250);
  }

  function stopTimer() {
    if (!timerId) return;
    clearInterval(timerId);
    elapsed += performance.now() - startedAt;
    timerId = undefined;
  }

  function render() {
    startOverlay.hidden = status !== 'start';
    overOverlay.hidden = status !== 'over';
    pausedOverlay.hidden = !isPaused;
    gridEl.classList.toggle('locked', !canPlay());
    outcomeTitle.textContent = isWon ? 'You Win!' : 'Game Over';
    outcomeTitle.classList.toggle('won', isWon);
    outcomeDetail.hidden = !isWon;
    outcomeDetail.textContent = `${isNewBest ? 'New Best' : 'Time'} · ${formatTime(elapsed)}`;
    minesText.textContent = String(difficulty().mines - flagsPlaced);
    timeText.textContent = formatTime(currentTime());
    bestText.textContent = best ? formatTime(best) : '—';
  }

  function buildBoard() {
    const { rows, cols, mines, size } = difficulty();
    stopTimer();
    clearTimeout(resultTimer);

    grid = range(rows).map((y) =>
      range(cols).map((x) => ({
        x,
        y,
        isMine: false,
        isRevealed: false,
        isFlagged: false,
        isExploded: false,
        neighborCount: 0,
        element: cellTemplate.content.firstElementChild.cloneNode(true),
      })),
    );
    cells = grid.flat();
    for (const [index, cell] of cells.entries()) cell.element.dataset.index = String(index);
    gridEl.style.setProperty('--cols', String(cols));
    gridEl.style.setProperty('--size', `${size}px`);
    gridEl.replaceChildren(...cells.map((cell) => cell.element));

    pressed = [];
    flagsPlaced = 0;
    safeLeft = rows * cols - mines;
    elapsed = 0;
    isFirstClick = true;
    isPaused = false;
    isWon = false;
    isNewBest = false;
    best = readNumber(bestKey(level));
  }

  function showStartScreen() {
    buildBoard();
    status = 'start';
    render();
  }

  function startGame(nextLevel) {
    level = nextLevel;
    buildBoard();
    status = 'playing';
    render();
  }

  function restart() {
    if (status !== 'start') startGame(level);
  }

  function neighborsOf({ x, y }) {
    return NEIGHBORS.map(([dx, dy]) => grid[y + dy]?.[x + dx]).filter(Boolean);
  }

  function placeMines(origin) {
    const candidates = cells.filter(
      (cell) => Math.abs(cell.x - origin.x) > 1 || Math.abs(cell.y - origin.y) > 1,
    );
    for (let i = 0; i < difficulty().mines; i++) {
      const j = i + Math.floor(Math.random() * (candidates.length - i));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
      candidates[i].isMine = true;
    }
    for (const cell of cells) {
      cell.neighborCount = neighborsOf(cell).filter((neighbor) => neighbor.isMine).length;
    }
  }

  function stateOf(cell) {
    if (cell.isExploded) return 'exploded';
    if (cell.isRevealed) return cell.isMine ? 'mine' : 'revealed';
    if (cell.isFlagged) return cell.isMine || status === 'playing' ? 'flag' : 'misflag';
    return 'hidden';
  }

  function paint(cell, delay = 0) {
    const { element } = cell;
    element.dataset.state = stateOf(cell);
    element.style.setProperty('--delay', `${Math.round(delay)}ms`);
    if (element.dataset.state === 'revealed' && cell.neighborCount > 0) {
      element.dataset.count = String(cell.neighborCount);
      element.textContent = element.dataset.count;
    }
  }

  function flood(starts) {
    const revealed = [];
    const queue = starts.map((cell) => [cell, 0]);
    for (const [cell, depth] of queue) {
      if (cell.isRevealed || cell.isFlagged) continue;
      cell.isRevealed = true;
      revealed.push([cell, depth]);
      if (cell.isMine) continue;
      safeLeft--;
      if (cell.neighborCount > 0) continue;
      for (const neighbor of neighborsOf(cell)) queue.push([neighbor, depth + 1]);
    }
    return revealed;
  }

  function open(starts) {
    const revealed = flood(starts);
    if (revealed.length === 0) return;

    const hits = revealed.filter(([cell]) => cell.isMine).map(([cell]) => cell);
    for (const cell of hits) cell.isExploded = true;
    for (const [cell, depth] of revealed) paint(cell, depth * REVEAL_STEP_MS);

    if (hits.length > 0) lose(hits[0]);
    else if (safeLeft === 0) win(starts[0], revealed.at(-1)[1] * REVEAL_STEP_MS);
  }

  function finish(won) {
    stopTimer();
    status = 'ending';
    isWon = won;
  }

  function showResult(delay) {
    render();
    resultTimer = setTimeout(() => {
      status = 'over';
      render();
    }, delay);
  }

  function lose(origin) {
    finish(false);
    const mines = cells.filter((cell) => cell.isMine && !cell.isRevealed && !cell.isFlagged);
    const farthest = Math.max(1, ...mines.map((cell) => distance(cell, origin)));

    for (const cell of mines) {
      const delay = (distance(cell, origin) / farthest) * CHAIN_MS;
      cell.isRevealed = true;
      paint(cell, delay);
    }
    for (const cell of cells) {
      if (cell.isFlagged && !cell.isMine) paint(cell, CHAIN_MS);
    }

    board.animate(SHAKE, { duration: 450, easing: 'ease-out' });
    showResult(CHAIN_MS + RESULT_DELAY_MS);
  }

  function win(origin, startDelay) {
    finish(true);
    const farthest = Math.max(1, ...cells.map((cell) => distance(cell, origin)));

    for (const cell of cells) {
      const delay = startDelay + (distance(cell, origin) / farthest) * WAVE_MS;
      cell.element.animate(WAVE, { duration: 500, delay, easing: 'ease-out' });
      if (!cell.isMine) continue;
      cell.isFlagged = true;
      paint(cell, delay);
    }
    flagsPlaced = difficulty().mines;

    isNewBest = !best || elapsed < best;
    if (isNewBest) {
      best = Math.round(elapsed);
      writeNumber(bestKey(level), best);
    }

    showResult(startDelay + WAVE_MS + RESULT_DELAY_MS);
  }

  function reveal(cell) {
    if (cell.isFlagged) return;
    if (isFirstClick) {
      placeMines(cell);
      isFirstClick = false;
      startTimer();
    }
    open([cell]);
  }

  function chord(cell) {
    const neighbors = neighborsOf(cell);
    const flags = neighbors.filter((neighbor) => neighbor.isFlagged).length;
    if (cell.neighborCount === 0 || flags !== cell.neighborCount) return;
    open(neighbors.filter((neighbor) => !neighbor.isRevealed && !neighbor.isFlagged));
  }

  function toggleFlag(cell) {
    if (cell.isRevealed) return;
    cell.isFlagged = !cell.isFlagged;
    flagsPlaced += cell.isFlagged ? 1 : -1;
    paint(cell);
  }

  function press(cell) {
    release();
    if (!cell?.isRevealed || cell.neighborCount === 0) return;
    pressed = neighborsOf(cell).filter((neighbor) => !neighbor.isRevealed && !neighbor.isFlagged);
    for (const neighbor of pressed) neighbor.element.classList.add('pressed');
  }

  function release() {
    for (const cell of pressed) cell.element.classList.remove('pressed');
    pressed = [];
  }

  function togglePause() {
    if (status !== 'playing') return;
    isPaused = !isPaused;
    if (isPaused) stopTimer();
    else if (!isFirstClick) startTimer();
    render();
  }

  function cellFrom(event) {
    return cells[event.target.closest('.cell')?.dataset.index];
  }

  gridEl.addEventListener('click', (event) => {
    const cell = cellFrom(event);
    if (!cell || !canPlay()) return;
    if (cell.isRevealed) chord(cell);
    else reveal(cell);
    render();
  });

  gridEl.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    const cell = cellFrom(event);
    if (!cell || !canPlay()) return;
    toggleFlag(cell);
    render();
  });

  gridEl.addEventListener('pointerdown', (event) => {
    if (event.button === 0 && canPlay()) press(cellFrom(event));
  });
  gridEl.addEventListener('pointerup', release);
  gridEl.addEventListener('pointerleave', release);

  for (const button of root.querySelectorAll('[data-level]')) {
    button.addEventListener('click', () => startGame(button.dataset.level));
  }
  root.querySelector('[data-restart]').addEventListener('click', restart);
  root.querySelector('[data-menu]').addEventListener('click', showStartScreen);

  const cleanups = [onGameKey(['r'], restart), onPause(togglePause, () => isPaused)];

  showStartScreen();

  return () => {
    stopTimer();
    clearTimeout(resultTimer);
    for (const cleanup of cleanups) cleanup();
  };
});
