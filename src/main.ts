import { loadBuiltinLevels } from './data/levels';
import { advance, current, newSession, recordEcho, resetRoom, rewind, undoEcho, type Session } from './core/session';
import type { Action } from './core/types';
import { drawDebug2D } from './render/debug2d';

/** Этап 1: отладочный 2D-режим для проверки ядра. */
function bootDebug2D(root: HTMLElement): void {
  const levels = loadBuiltinLevels();
  let session: Session = newSession(levels[0]!);
  const canvas = document.createElement('canvas');
  const info = document.createElement('pre');
  root.append(canvas, info);
  const ctx = canvas.getContext('2d')!;
  const cs = 48;
  const draw = () => {
    const s = current(session);
    canvas.width = s.level.width * cs;
    canvas.height = s.level.height * cs;
    drawDebug2D(ctx, s, cs);
    info.textContent = `tick ${s.tick}/${s.level.tickLimit}  echoes ${session.records.length}/${s.level.maxEchoes}  ${s.outcome}  rec ${s.record}`;
  };
  const keys: Record<string, Action> = {
    ArrowUp: 'up',
    KeyW: 'up',
    ArrowRight: 'right',
    KeyD: 'right',
    ArrowDown: 'down',
    KeyS: 'down',
    ArrowLeft: 'left',
    KeyA: 'left',
    Space: 'none',
    KeyF: 'interact',
  };
  window.addEventListener('keydown', (e) => {
    const a = keys[e.code];
    if (a) {
      e.preventDefault();
      session = advance(session, a).session;
      if (current(session).outcome === 'timeout') session = recordEcho(session);
    } else if (e.code === 'KeyR') session = recordEcho(session);
    else if (e.code === 'KeyZ') session = undoEcho(session);
    else if (e.code === 'Backspace') session = rewind(session);
    else if (e.code === 'KeyX') session = resetRoom(session);
    draw();
  });
  draw();
}

const root = document.getElementById('app')!;
bootDebug2D(root);
