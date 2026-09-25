import '@fontsource/unbounded/500.css';
import '@fontsource/unbounded/800.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/600.css';
import './ui/styles.css';
import { App } from './app';

const app = new App(document.getElementById('app')!);
app.start();

// Для отладки и автоматических проверок в дев-режиме.
if (import.meta.env.DEV) (window as unknown as { __app: App }).__app = app;
