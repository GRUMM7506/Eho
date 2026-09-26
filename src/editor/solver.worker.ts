/// <reference lib="webworker" />
import { compileLevel } from '../core/level';
import { Solver, type SolveResult } from '../core/solver';

export interface SolveRequest {
  raw: unknown;
  timeLimitMs: number;
}

export type SolveResponse =
  { ok: true; result: SolveResult } | { ok: false; error: string } | { progress: number };

/** Решатель в отдельном потоке: интерфейс редактора не подвисает. */
self.onmessage = (e: MessageEvent<SolveRequest>) => {
  try {
    const level = compileLevel(e.data.raw);
    let last = 0;
    const result = new Solver(level, () => performance.now()).solve({
      timeLimitMs: e.data.timeLimitMs,
      improveMs: 1500,
      onProgress: ({ elapsed }) => {
        if (elapsed - last > 250) {
          last = elapsed;
          (self as unknown as Worker).postMessage({
            progress: Math.min(1, elapsed / e.data.timeLimitMs),
          } satisfies SolveResponse);
        }
      },
    });
    (self as unknown as Worker).postMessage({ ok: true, result } satisfies SolveResponse);
  } catch (err) {
    (self as unknown as Worker).postMessage({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    } satisfies SolveResponse);
  }
};
