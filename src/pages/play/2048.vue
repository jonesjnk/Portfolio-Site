<script setup lang="ts">
import { useEventListener } from '@vueuse/core';
import { onMounted, ref, useTemplateRef } from 'vue';

import GameControls from '@/components/GameControls.vue';
import GamePage from '@/components/GamePage.vue';
import { readSave, writeSave } from '@/lib/storage';

definePage({ meta: { title: '2048' } });

const HIGH_SCORE_KEY = '2048-best-score';

const iframe = useTemplateRef('iframe');
const score = ref(0);
const highScore = ref(readSave(HIGH_SCORE_KEY, 0));

const focus = () => iframe.value?.focus();

useEventListener('message', ({ source, data }: MessageEvent<{ type?: string; score: number }>) => {
  if (source !== iframe.value?.contentWindow || data.type !== '2048-update') return;

  score.value = data.score;
  if (data.score <= highScore.value) return;
  highScore.value = data.score;
  writeSave(HIGH_SCORE_KEY, data.score);
});

onMounted(focus);
</script>

<template>
  <GamePage>
    <div class="game-wrapper">
      <div class="left-section" @click="focus">
        <iframe
          ref="iframe"
          class="game-iframe"
          src="/gameassets/2048.html"
          title="2048 game"
          scrolling="no"
          @load="focus"
        ></iframe>
      </div>

      <div class="right-section">
        <h1 class="game-title">2048</h1>

        <div class="info-box score-box">
          <div class="label score-label">Score</div>
          <div class="value score-value">{{ score }}</div>

          <div class="score-divider"></div>

          <div class="label high-score-label">High Score</div>
          <div class="value high-score-value">{{ highScore }}</div>
        </div>

        <GameControls
          :controls="[
            { action: 'Move Tiles', keys: ['↑', '↓', '←', '→'] },
            { action: 'Alternative', keys: ['W', 'A', 'S', 'D'] },
            { action: 'Restart', keys: ['R'] },
          ]"
        />
      </div>
    </div>
  </GamePage>
</template>

<style scoped>
.game-iframe {
  width: 530px;
  height: 530px;
  background: #faf8ef;
}

.score-box {
  padding: 16px 10px;
}

.label {
  margin-bottom: 4px;
}
</style>
