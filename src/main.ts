import { compileLevel } from './core/level';
import { SANDBOX_LEVEL } from './data/sandbox';
import { GameController } from './game/controller';
import { InputHub } from './input/input';
import { GameView } from './render/gameView';

/** Этап 2: 3D-сцена, камера и управление в песочнице. */
function boot(root: HTMLElement): void {
  document.body.style.margin = '0';
  document.body.style.background = '#0D0B1E';
  document.body.style.overflow = 'hidden';
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:100vw;height:100vh;touch-action:none';
  root.append(canvas);
  const view = new GameView(canvas, {
    quality: 'high',
    colorblind: new URLSearchParams(location.search).has('cb'),
    reducedMotion: false,
    perspective: new URLSearchParams(location.search).has('persp'),
    freeCamera: false,
    isMobile: false,
  });
  const input = new InputHub();
  input.attach(canvas, view.orbit);
  input.gameplay = true;
  const level = compileLevel(SANDBOX_LEVEL);
  const ctl = new GameController(view, input, {
    onTick: () => undefined,
    onReset: () => undefined,
    onWin: () => undefined,
    onDeath: () => undefined,
    onLoopEnd: () => undefined,
    onLoopStart: () => undefined,
  }, level);
  input.onCommand = (cmd) => {
    if (cmd === 'camLeft') view.orbit.turn(-1);
    else if (cmd === 'camRight') view.orbit.turn(1);
    else if (cmd === 'camReset') view.orbit.reset();
    else if (cmd === 'record') ctl.record();
    else if (cmd === 'undoEcho') ctl.undoEcho();
    else if (cmd === 'rewind') ctl.rewind();
  };
  const resize = () => view.resize(window.innerWidth, window.innerHeight, { top: 0, right: 0, bottom: 0, left: 0 });
  window.addEventListener('resize', resize);
  resize();
  ctl.load(level);
  let last = performance.now();
  const loop = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    ctl.frame(dt);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

boot(document.getElementById('app')!);
