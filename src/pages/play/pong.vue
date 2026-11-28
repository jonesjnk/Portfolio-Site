<script setup lang="ts">
import { useRafFn } from '@vueuse/core';
import { onBeforeUnmount, onMounted, reactive, ref, useTemplateRef } from 'vue';

import GameControls from '@/components/GameControls.vue';
import GamePage from '@/components/GamePage.vue';
import { useHeldKeys, usePause } from '@/composables/useGameInput';
import { setupCanvas } from '@/lib/canvas';

definePage({ meta: { title: 'Pong' } });

type Mode = 'cpu' | 'pvp';
type Side = 'left' | 'right';

interface Paddle {
  x: number;
  y: number;
  speed: number;
  flash: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  decay: number;
  size: number;
  rgb: string;
}

const WIDTH = 700;
const HEIGHT = 500;
const WIN_SCORE = 7;
const PADDLE_WIDTH = 12;
const PADDLE_HEIGHT = 85;
const PADDLE_Y = (HEIGHT - PADDLE_HEIGHT) / 2;
const BALL_RADIUS = 7;
const AI_SPEED = 5.7;
const STEP_MS = 1000 / 60;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const canvas = useTemplateRef('canvas');
const status = ref<'start' | 'playing' | 'over'>('start');
const isPaused = ref(false);
const outcome = ref('');
const scores = reactive<Record<Side, number>>({ left: 0, right: 0 });

let ctx: CanvasRenderingContext2D;
let audioCtx: AudioContext | undefined;
let gameMode: Mode = 'cpu';
let isResetting = false;
let serveTimer: ReturnType<typeof setTimeout> | undefined;
let trail: { x: number; y: number }[] = [];
let particles: Particle[] = [];
let shakeFrames = 0;
let shakeIntensity = 0;

const leftPaddle: Paddle = { x: 20, y: PADDLE_Y, speed: 10.5, flash: 0 };
const rightPaddle: Paddle = { x: WIDTH - 20 - PADDLE_WIDTH, y: PADDLE_Y, speed: 10.5, flash: 0 };
const ball = { x: WIDTH / 2, y: HEIGHT / 2, dx: 0, dy: 0, speed: 4, baseSpeed: 4 };

const keys = useHeldKeys(['ArrowUp', 'ArrowDown', 'Space']);
const isHeld = (name: string) => !keys.isModifierDown() && keys.isDown(name);

const loop = useRafFn(
  ({ delta }) => {
    update(Math.min(delta, 50) / STEP_MS);
    draw();
  },
  { immediate: false },
);

function serveBall() {
  clearTimeout(serveTimer);
  serveTimer = setTimeout(() => {
    isResetting = false;
    const dir = Math.random() > 0.5 ? 1 : -1;
    ball.dx = dir * ball.speed;
    ball.dy = (Math.random() * 2 - 1) * ball.speed * 0.5;
  }, 1000);
}

function getAudioCtx() {
  audioCtx ??= new AudioContext();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function beep(frequency: number, duration: number, type: OscillatorType = 'square', volume = 0.15) {
  const audio = getAudioCtx();
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.connect(gain);
  gain.connect(audio.destination);
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, audio.currentTime);
  gain.gain.setValueAtTime(volume, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + duration);
  oscillator.start(audio.currentTime);
  oscillator.stop(audio.currentTime + duration);
}

function spawnParticles(x: number, y: number, rgb: string) {
  for (let i = 0; i < 18; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1.5 + Math.random() * 4;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1,
      decay: 0.03 + Math.random() * 0.04,
      size: 2 + Math.random() * 3,
      rgb,
    });
  }
}

function hitsPaddle(paddle: Paddle) {
  return (
    ball.x + BALL_RADIUS > paddle.x &&
    ball.x - BALL_RADIUS < paddle.x + PADDLE_WIDTH &&
    ball.y + BALL_RADIUS > paddle.y &&
    ball.y - BALL_RADIUS < paddle.y + PADDLE_HEIGHT
  );
}

function drawCenterLine() {
  const segmentHeight = 18;
  const segmentGap = 12;
  const segmentCount = Math.floor(HEIGHT / (segmentHeight + segmentGap));
  const startY = (HEIGHT - segmentCount * (segmentHeight + segmentGap) + segmentGap) / 2;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
  for (let i = 0; i < segmentCount; i += 1) {
    const y = startY + i * (segmentHeight + segmentGap);
    ctx.beginPath();
    ctx.roundRect(WIDTH / 2 - 1.5, y, 3, segmentHeight, 2);
    ctx.fill();
  }
}

function drawField() {
  ctx.fillStyle = '#0d0d0d';
  ctx.fillRect(-10, -10, WIDTH + 20, HEIGHT + 20);
  drawCenterLine();
}

function drawPaddle(paddle: Paddle) {
  const isFlashing = paddle.flash > 0;
  ctx.save();
  if (isFlashing) {
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 24;
  }
  ctx.fillStyle = isFlashing
    ? `rgba(255, 255, 255, ${0.7 + 0.3 * (paddle.flash / 8)})`
    : 'rgba(255, 255, 255, 0.9)';
  ctx.beginPath();
  ctx.roundRect(paddle.x, paddle.y, PADDLE_WIDTH, PADDLE_HEIGHT, 5);
  ctx.fill();
  ctx.restore();
}

function draw() {
  const shakeX = shakeFrames > 0 ? (Math.random() - 0.5) * shakeIntensity : 0;
  const shakeY = shakeFrames > 0 ? (Math.random() - 0.5) * shakeIntensity : 0;

  ctx.save();
  ctx.translate(shakeX, shakeY);

  drawField();

  trail.forEach((point, i) => {
    const previous = trail[i - 1];
    if (!previous) return;
    const fraction = i / trail.length;
    ctx.beginPath();
    ctx.moveTo(previous.x, previous.y);
    ctx.lineTo(point.x, point.y);
    ctx.strokeStyle = `rgba(255, 255, 255, ${fraction * 0.22})`;
    ctx.lineWidth = fraction * BALL_RADIUS * 1.4;
    ctx.lineCap = 'round';
    ctx.stroke();
  });

  for (const particle of particles) {
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size * particle.life, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${particle.rgb}, ${particle.life * 0.9})`;
    ctx.fill();
  }

  drawPaddle(leftPaddle);
  drawPaddle(rightPaddle);

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, BALL_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function resetMatch() {
  scores.left = 0;
  scores.right = 0;
  trail = [];
  particles = [];
}

function resetPositions() {
  ball.x = WIDTH / 2;
  ball.y = HEIGHT / 2;
  ball.speed = ball.baseSpeed;
  ball.dx = 0;
  ball.dy = 0;
  leftPaddle.y = PADDLE_Y;
  rightPaddle.y = PADDLE_Y;
  trail = [];
  isResetting = true;
  serveBall();
}

function showStartScreen() {
  status.value = 'start';
  clearTimeout(serveTimer);
  loop.pause();
  resetMatch();
  drawField();
}

function startGame(mode: Mode) {
  gameMode = mode;
  status.value = 'playing';
  isPaused.value = false;
  resetMatch();
  getAudioCtx();
  resetPositions();
  loop.resume();
}

function togglePause() {
  if (status.value !== 'playing') return;
  isPaused.value = !isPaused.value;
  if (isPaused.value) loop.pause();
  else loop.resume();
}

function checkWin() {
  if (scores.left < WIN_SCORE && scores.right < WIN_SCORE) {
    resetPositions();
    return;
  }
  status.value = 'over';
  loop.pause();
  const rightWon = scores.right >= WIN_SCORE;
  if (gameMode === 'cpu') outcome.value = rightWon ? 'You Win!' : 'Computer Wins!';
  else outcome.value = rightWon ? 'Right Player Wins!' : 'Left Player Wins!';
}

function updatePaddles(dt: number) {
  if (isHeld('ArrowUp')) rightPaddle.y -= rightPaddle.speed * dt;
  if (isHeld('ArrowDown')) rightPaddle.y += rightPaddle.speed * dt;

  if (gameMode === 'cpu') {
    const target = ball.y - PADDLE_HEIGHT / 2;
    const move = clamp((target - leftPaddle.y) * 0.18, -AI_SPEED, AI_SPEED);
    leftPaddle.y += move * dt;
  } else {
    if (isHeld('w')) leftPaddle.y -= leftPaddle.speed * dt;
    if (isHeld('s')) leftPaddle.y += leftPaddle.speed * dt;
  }

  leftPaddle.y = clamp(leftPaddle.y, 0, HEIGHT - PADDLE_HEIGHT);
  rightPaddle.y = clamp(rightPaddle.y, 0, HEIGHT - PADDLE_HEIGHT);
}

function updateBallWallCollision() {
  if (ball.y - BALL_RADIUS < 0) ball.y = BALL_RADIUS;
  else if (ball.y + BALL_RADIUS > HEIGHT) ball.y = HEIGHT - BALL_RADIUS;
  else return;

  ball.dy *= -1;
  beep(220, 0.07);
  shakeFrames = 4;
  shakeIntensity = 2;
}

function updateBallPaddleCollision() {
  const paddle = ball.x < WIDTH / 2 ? leftPaddle : rightPaddle;
  if (!hitsPaddle(paddle)) return;

  const hitOffset = clamp((ball.y - (paddle.y + PADDLE_HEIGHT / 2)) / (PADDLE_HEIGHT / 2), -1, 1);
  const angle = (Math.PI / 4) * hitOffset;
  const dir = ball.x < WIDTH / 2 ? 1 : -1;
  ball.speed = Math.min(ball.speed + 0.45, 16);
  ball.dx = dir * ball.speed * Math.cos(angle);
  ball.dy = ball.speed * Math.sin(angle);
  if (paddle === leftPaddle) {
    ball.x = leftPaddle.x + PADDLE_WIDTH + BALL_RADIUS;
    leftPaddle.flash = 8;
  } else {
    ball.x = rightPaddle.x - BALL_RADIUS;
    rightPaddle.flash = 8;
  }
  beep(300 + Math.abs(hitOffset) * 100, 0.07);
  shakeFrames = 6;
  shakeIntensity = 3.5;
}

function updateBallScoring() {
  const scorer: Side | null = ball.x < 0 ? 'right' : ball.x > WIDTH ? 'left' : null;
  if (!scorer) return;

  spawnParticles(
    scorer === 'right' ? 0 : WIDTH,
    ball.y,
    scorer === 'right' ? '255,100,100' : '100,200,255',
  );
  scores[scorer] += 1;
  beep(140, 0.35, 'sawtooth', 0.2);
  shakeFrames = 14;
  shakeIntensity = 7;
  checkWin();
}

function updateParticles(dt: number) {
  particles = particles.filter((particle) => {
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vx *= 0.92 ** dt;
    particle.vy *= 0.92 ** dt;
    particle.life -= particle.decay * dt;
    return particle.life > 0;
  });
}

function update(dt: number) {
  updatePaddles(dt);

  if (leftPaddle.flash > 0) leftPaddle.flash -= dt;
  if (rightPaddle.flash > 0) rightPaddle.flash -= dt;
  if (shakeFrames > 0) shakeFrames -= dt;

  if (!isResetting) {
    trail.push({ x: ball.x, y: ball.y });
    if (trail.length > 10) trail.shift();

    ball.x += ball.dx * dt;
    ball.y += ball.dy * dt;

    updateBallWallCollision();
    updateBallPaddleCollision();
    updateBallScoring();
  }

  updateParticles(dt);
}

usePause(togglePause, () => isPaused.value);

onMounted(() => {
  if (!canvas.value) return;
  ctx = setupCanvas(canvas.value, WIDTH, HEIGHT);
  drawField();
});

onBeforeUnmount(() => {
  clearTimeout(serveTimer);
  if (audioCtx?.state !== 'closed') audioCtx?.close();
});
</script>

<template>
  <GamePage>
    <div class="game-wrapper">
      <div class="left-section">
        <canvas ref="canvas"></canvas>
        <div v-if="status === 'start'" class="overlay-msg">
          <h2 class="menu-title">Pong</h2>
          <div class="overlay-actions">
            <button class="overlay-btn" type="button" @click="startGame('cpu')">1 Player</button>
            <button class="overlay-btn" type="button" @click="startGame('pvp')">2 Players</button>
          </div>
        </div>
        <div v-else-if="status === 'over'" class="overlay-msg">
          <h2 class="menu-title">Game Over</h2>
          <div class="outcome">{{ outcome }}</div>
          <button class="overlay-btn" type="button" @click="showStartScreen">Play Again</button>
        </div>
        <div v-else-if="isPaused" class="overlay-msg">
          <h2 class="menu-title">Paused</h2>
        </div>
      </div>

      <div class="right-section">
        <h1 class="game-title">Pong</h1>
        <div class="info-box score-box">
          <div class="label score-label">Score</div>
          <div class="value score-value">{{ scores.left }} - {{ scores.right }}</div>
        </div>
        <GameControls
          :controls="[
            { action: 'Left Paddle', keys: ['W', 'S'] },
            { action: 'Right Paddle', keys: ['↑', '↓'] },
            { action: 'Pause', keys: ['Esc', 'P'] },
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
  width: 724px;
  height: 524px;
}

canvas {
  width: 700px;
  height: 500px;
  background: #0d0d0d;
  border-radius: 8px;
  border: 1px solid #333333;
  box-shadow: inset 0 0 40px rgba(0, 0, 0, 0.5);
}

.outcome {
  margin-bottom: 20px;
  color: #94a3b8;
  font-size: 14px;
  text-transform: uppercase;
}

.score-box {
  min-height: 100px;
}
</style>
