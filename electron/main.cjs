// Windows-обёртка «ЭХО»: окно Electron, игра грузится из собранной папки dist
// через собственный протокол app:// (так работают воркеры и localStorage, в отличие от file://).
const { app, BrowserWindow, protocol, net, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

const dist = path.join(__dirname, '..', 'dist');

function serveDist() {
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.normalize(path.join(dist, rel));
    // Не выпускаем запросы за пределы папки игры.
    if (!file.startsWith(dist)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 640,
    minHeight: 400,
    backgroundColor: '#0D0B1E',
    title: 'ЭХО',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: true },
  });
  win.removeMenu();
  const smoke = process.env.ECHO_SMOKE === '1';
  if (smoke) {
    // Самопроверка сборки: окно не показываем, печатаем ошибки страницы и выходим.
    const errors = [];
    win.webContents.on('console-message', (e) => {
      if ((e.level === 'error' || e.level === 'warning') && !e.message.includes('Electron Security Warning'))
        errors.push(e.message);
    });
    win.webContents.on('did-fail-load', (_e, code, desc) => errors.push(`load failed ${code} ${desc}`));
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const ok = await win.webContents.executeJavaScript(
          "!!document.querySelector('#stage') && document.querySelectorAll('.screen').length > 0",
        );
        console.log(ok && !errors.length ? 'SMOKE OK' : `SMOKE FAIL ${ok} ${errors.join(' | ')}`);
        app.exit(ok && !errors.length ? 0 : 1);
      }, 4000);
    });
  } else {
    win.once('ready-to-show', () => win.show());
  }
  // F11 — полный экран, Alt+Enter — тоже.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11' || (input.alt && input.key === 'Enter')) {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    }
  });
  // Внешние ссылки — в браузер, а не в окно игры.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  void win.loadURL('app://game/index.html');
}

// Один экземпляр игры: повторный запуск просто поднимает окно.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(() => {
    serveDist();
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
