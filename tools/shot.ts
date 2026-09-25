/**
 * Проверка в настоящем браузере: открывает страницу в headless Chrome/Edge, собирает ошибки
 * консоли, выполняет сценарий (клавиши, клики, тапы) и сохраняет скриншоты.
 *
 *   npx tsx tools/shot.ts <url> <out.png> [--mobile] [--steps "key:KeyW,wait:300,shot:a.png,click:#id,tap:200x300"]
 */
import puppeteer, { type Page } from 'puppeteer-core';
import { existsSync } from 'node:fs';

const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

async function runSteps(page: Page, steps: string, outDir: string): Promise<void> {
  for (const raw of steps.split(',').map((s) => s.trim()).filter(Boolean)) {
    const [kind, ...rest] = raw.split(':');
    const arg = rest.join(':');
    switch (kind) {
      case 'key':
        await page.keyboard.press(arg as never);
        break;
      case 'down':
        await page.keyboard.down(arg as never);
        break;
      case 'up':
        await page.keyboard.up(arg as never);
        break;
      case 'wait':
        await new Promise((r) => setTimeout(r, Number(arg)));
        break;
      case 'click':
        await page.click(arg);
        break;
      case 'tap': {
        const [x, y] = arg.split('x').map(Number);
        await page.touchscreen.tap(x!, y!);
        break;
      }
      case 'mouse': {
        const [x, y] = arg.split('x').map(Number);
        await page.mouse.click(x!, y!);
        break;
      }
      case 'eval':
        console.log('eval →', await page.evaluate(arg));
        break;
      case 'shot':
        await page.screenshot({ path: `${outDir}/${arg}` });
        console.log('screenshot', arg);
        break;
    }
  }
}

async function main(): Promise<void> {
  const [url = 'http://localhost:5173/', out = 'shot.png', ...flags] = process.argv.slice(2);
  const mobile = flags.includes('--mobile');
  const stepsIdx = flags.indexOf('--steps');
  const steps = stepsIdx >= 0 ? (flags[stepsIdx + 1] ?? '') : '';
  const executablePath = BROWSERS.find((p) => existsSync(p));
  if (!executablePath) throw new Error('Не найден Chrome/Edge');
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  if (mobile) {
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36');
  } else {
    await page.setViewport({ width: 1280, height: 800 });
  }
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warn') errors.push(`[${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${(e as Error).message}`));
  await page.goto(url, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 1500));
  const outDir = out.replace(/[\\/][^\\/]*$/, '') || '.';
  await runSteps(page, steps, outDir);
  await page.screenshot({ path: out });
  console.log(errors.length ? errors.join('\n') : 'NO CONSOLE ERRORS');
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
