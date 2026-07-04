import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { bootstrapCourseForge } from './bootstrap/courseforge-bootstrap.js';

let mainWindow: BrowserWindow | null = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.whenReady().then(async () => {
    try {
      await launchCourseForgeWindow();
    } catch (error) {
      console.error('Failed to start CourseForge Electron shell', error);
      await launchStartupErrorWindow(error);
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void launchCourseForgeWindow();
      }
    });
  });
}

async function launchCourseForgeWindow(): Promise<void> {
  const repoRoot = app.isPackaged ? app.getAppPath() : process.cwd();
  const runtimeRoot = path.join(app.getPath('userData'), '.courseforge-runtime', 'otto');
  const result = await bootstrapCourseForge({ repoRoot, runtimeRoot });

  const window = new BrowserWindow({
    width: 1280,
    height: 920,
    show: false,
    backgroundColor: '#f2efe6',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow = window;
  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });
  window.once('ready-to-show', () => {
    window.show();
  });

  await window.loadFile(result.uiFilePath);
}

async function launchStartupErrorWindow(error: unknown): Promise<void> {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  const window = new BrowserWindow({
    width: 960,
    height: 680,
    backgroundColor: '#1f1f1f',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow = window;
  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });
  window.once('ready-to-show', () => {
    window.show();
  });

  const escapedMessage = escapeHtml(message);
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>CourseForge Startup Error</title>
        <style>
          body {
            margin: 0;
            min-height: 100vh;
            display: grid;
            place-items: center;
            background: linear-gradient(180deg, #181818, #262626);
            color: #f7f3ea;
            font-family: Georgia, 'Times New Roman', serif;
            padding: 32px;
          }
          main {
            width: min(900px, 100%);
            background: rgba(255, 255, 255, 0.04);
            border: 1px solid rgba(255, 255, 255, 0.14);
            border-radius: 24px;
            padding: 28px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
          }
          pre {
            white-space: pre-wrap;
            word-break: break-word;
            background: rgba(0, 0, 0, 0.24);
            border-radius: 16px;
            padding: 18px;
            overflow: auto;
          }
        </style>
      </head>
      <body>
        <main>
          <h1>CourseForge could not start</h1>
          <p>The Electron shell failed while bootstrapping Otto and the CourseForge handoff.</p>
          <pre>${escapedMessage}</pre>
        </main>
      </body>
    </html>
  `)}`);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}