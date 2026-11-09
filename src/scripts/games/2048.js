import { defineElement, readNumber, writeNumber } from '../game';

const HIGH_SCORE_KEY = '2048-best-score';

defineElement('game-2048', (root) => {
  const iframe = root.querySelector('iframe');
  const scoreText = root.querySelector('[data-score]');
  const highScoreText = root.querySelector('[data-high-score]');
  const focus = () => iframe.focus();
  let highScore = readNumber(HIGH_SCORE_KEY);

  const onMessage = ({ source, data }) => {
    if (source !== iframe.contentWindow || data?.type !== '2048-update') return;

    scoreText.textContent = String(data.score);
    if (data.score <= highScore) return;
    highScore = data.score;
    writeNumber(HIGH_SCORE_KEY, highScore);
    highScoreText.textContent = String(highScore);
  };

  highScoreText.textContent = String(highScore);
  root.querySelector('.left-section').addEventListener('click', focus);
  iframe.addEventListener('load', focus);
  addEventListener('message', onMessage);
  focus();

  return () => removeEventListener('message', onMessage);
});
