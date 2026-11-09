import { defineElement } from '../game';

defineElement('game-stickman-hook', (root) => {
  const iframe = root.querySelector('iframe');
  const focus = () => iframe.focus();

  root.querySelector('.left-section').addEventListener('click', focus);
  root.querySelector('.fullscreen-btn').addEventListener('click', () => iframe.requestFullscreen());
  iframe.addEventListener('load', focus);
  focus();
});
