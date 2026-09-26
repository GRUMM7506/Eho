import '@fontsource/unbounded/500.css';
import '@fontsource/unbounded/800.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/600.css';
import './ui/styles.css';
import { registerSW } from 'virtual:pwa-register';
import { App } from './app';

const app = new App(document.getElementById('app')!);
app.start();

// Для отладки и автоматических проверок в дев-режиме.
if (import.meta.env.DEV) (window as unknown as { __app: App }).__app = app;

// Офлайн-режим и установка на домашний экран (service worker; в дев-режиме не регистрируется).
if (import.meta.env.PROD && 'serviceWorker' in navigator) registerSW({ immediate: true });
