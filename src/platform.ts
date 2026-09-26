import { Capacitor } from '@capacitor/core';
import type { App } from './app';

/** Игра запущена как нативное приложение (APK через Capacitor). */
export const isNativeApp = Capacitor.isNativePlatform();

/** Игра запущена в Electron-обёртке для Windows (свой протокол app://). */
export const isDesktopApp = location.protocol === 'app:';

/** Service worker нужен только в браузере: обёртки и так работают офлайн. */
export const wantsServiceWorker = !isNativeApp && !isDesktopApp && location.protocol.startsWith('http');

/** Нативные мелочи Android: системная кнопка «Назад» и выход из приложения. */
export async function setupNative(app: App): Promise<void> {
  if (!isNativeApp) return;
  const { App: NativeApp } = await import('@capacitor/app');
  await NativeApp.addListener('backButton', () => {
    if (!app.handleBack()) void NativeApp.exitApp();
  });
  await NativeApp.addListener('appStateChange', ({ isActive }) => {
    if (!isActive) app.onBackgroundPublic();
  });
}
