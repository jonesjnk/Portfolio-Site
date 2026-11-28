import { useEventListener } from '@vueuse/core';

const hasModifier = (event: KeyboardEvent) => event.ctrlKey || event.metaKey || event.altKey;

export function useGameKey(keys: string[], handler: (event: KeyboardEvent) => void) {
  const wanted = new Set(keys.map((key) => key.toLowerCase()));

  useEventListener('keydown', (event) => {
    const key = event.key?.toLowerCase();
    if (key && !hasModifier(event) && wanted.has(key)) handler(event);
  });
}

export function usePause(togglePause: () => void, isPaused: () => boolean) {
  useGameKey(['Escape', 'p'], (event) => {
    event.preventDefault();
    togglePause();
  });

  useEventListener('blur', () => {
    if (!isPaused()) togglePause();
  });
}

export function useHeldKeys(preventCodes: string[], onChange?: () => void) {
  const down = new Set<string>();

  useEventListener('keydown', (event) => {
    if (preventCodes.includes(event.code)) event.preventDefault();
    down.add(event.code.toLowerCase());
    if (event.key) down.add(event.key.toLowerCase());
    onChange?.();
  });

  useEventListener('keyup', (event) => {
    down.delete(event.code.toLowerCase());
    if (event.key) down.delete(event.key.toLowerCase());
    onChange?.();
  });

  useEventListener('blur', () => {
    down.clear();
    onChange?.();
  });

  return {
    isDown: (...names: string[]) => names.some((name) => down.has(name.toLowerCase())),
    isModifierDown: () => ['control', 'meta', 'alt'].some((name) => down.has(name)),
  };
}
