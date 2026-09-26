/**
 * Решатель уровней: `npm run solve [-- id ...] [--time 30000] [--write-par] [--changed]`.
 *
 * Для каждого уровня `src/levels/worldN/levelM.json` ищет решение с минимальным числом копий,
 * сохраняет его рядом как `levelM.solution.json` и сверяет с `par` уровня.
 *   --write-par  — записать найденные эхо/тики в `par` уровня;
 *   --changed    — решать только уровни без действующего эталона;
 *   --time N     — лимит времени на уровень, мс;
 *   --improve N  — сколько мс продолжать поиск ради меньшего числа тиков.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { compileLevel } from '../src/core/level';
import { playSolution } from '../src/core/sim';
import { Solver } from '../src/core/solver';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'levels');

export interface SolutionFile {
  id: string;
  loops: string[];
  echoes: number;
  ticks: number;
  provenMinimal: boolean;
}

function levelFiles(): string[] {
  const out: string[] = [];
  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const f of readdirSync(join(root, dir.name))) {
      if (/^level[\w-]*\.json$/.test(f) && !f.endsWith('.solution.json')) out.push(join(root, dir.name, f));
    }
  }
  return out.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

function main(): void {
  const args = process.argv.slice(2);
  const writePar = args.includes('--write-par');
  const changedOnly = args.includes('--changed');
  const timeIdx = args.indexOf('--time');
  const timeLimitMs = timeIdx >= 0 ? Number(args[timeIdx + 1]) : 30000;
  const impIdx = args.indexOf('--improve');
  const improveMs = impIdx >= 0 ? Number(args[impIdx + 1]) : 3000;
  const ids = args.filter(
    (a, i) => !a.startsWith('--') && args[i - 1] !== '--time' && args[i - 1] !== '--improve',
  );
  let failed = 0;
  const rows: string[] = [];

  for (const file of levelFiles()) {
    const json = JSON.parse(readFileSync(file, 'utf8')) as {
      id: string;
      par: { echoes: number; ticks: number };
    } & Record<string, unknown>;
    if (ids.length && !ids.includes(json.id)) continue;
    const level = compileLevel(json);
    const solFile = file.replace(/\.json$/, '.solution.json');

    if (changedOnly && existsSync(solFile)) {
      const sol = JSON.parse(readFileSync(solFile, 'utf8')) as SolutionFile;
      if (playSolution(level, sol.loops).state.outcome === 'won') {
        rows.push(`${json.id.padEnd(8)} ok (эталон есть)`);
        continue;
      }
    }

    const t0 = performance.now();
    const res = new Solver(level, () => performance.now()).solve({ timeLimitMs, improveMs });
    const ms = Math.round(performance.now() - t0);
    if (!res.solved) {
      failed++;
      rows.push(`${json.id.padEnd(8)} НЕ РЕШЁН за ${ms} мс${res.timedOut ? ' (лимит времени)' : ''}`);
      continue;
    }
    // Проверка: решение действительно побеждает.
    const check = playSolution(level, res.loops);
    if (check.state.outcome !== 'won') {
      failed++;
      rows.push(`${json.id.padEnd(8)} ОШИБКА: решение не проходит проверку`);
      continue;
    }
    const sol: SolutionFile = {
      id: json.id,
      loops: res.loops,
      echoes: res.echoes,
      ticks: res.ticks,
      provenMinimal: res.provenMinimal,
    };
    writeFileSync(solFile, JSON.stringify(sol, null, 2) + '\n');
    let note = '';
    if (json.par.echoes !== res.echoes || json.par.ticks !== res.ticks) {
      note = ` (par в файле: ${json.par.echoes}/${json.par.ticks})`;
      if (writePar) {
        json.par = { echoes: res.echoes, ticks: res.ticks };
        writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
        note += ' → обновлён';
      }
    }
    rows.push(
      `${json.id.padEnd(8)} эхо ${res.echoes}${res.provenMinimal ? ' (мин.)' : ' (?)'}  тики ${String(res.ticks).padStart(3)}  узлы ${String(res.nodes).padStart(8)}  ${String(ms).padStart(6)} мс${note}`,
    );
    console.log(rows[rows.length - 1]);
  }
  console.log('\n' + rows.join('\n'));
  if (failed) {
    console.error(`\nНе решено уровней: ${failed}`);
    process.exit(1);
  }
}

main();
