/** Проверка офлайн-режима PWA: `npx tsx tools/offline-check.ts [url]` (нужен запущенный `npm run preview`). */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:4173/';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].find((p) => existsSync(p));
const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 640, height: 400 });
await page.goto(url, { waitUntil: 'networkidle0' });
await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.ready;
  return reg.active?.state;
});
await page.reload({ waitUntil: 'networkidle0' });
await page.setOfflineMode(true);
await page.reload({ waitUntil: 'domcontentloaded' });
await new Promise((r) => setTimeout(r, 2500));
const ok = await page.evaluate(() => !!document.querySelector('#stage') && document.querySelectorAll('.screen').length > 0);
console.log(ok ? 'OFFLINE OK' : 'OFFLINE FAIL');
await browser.close();
process.exit(ok ? 0 : 1);
