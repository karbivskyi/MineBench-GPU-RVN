const fs = require("fs");
const { spawn } = require("child_process");
const path = require("path");
const { app, BrowserWindow, ipcMain } = require("electron");

let mainWindow = null;
let miner = null;

// Функція для логування
function log(message) {
  console.log(new Date().toISOString(), message);
}

// Створення головного вікна
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  // === 🟢 Production mode (після build'у) ===
  if (app.isPackaged) {
    const indexPath = path.join(app.getAppPath(), "web-dist", "index.html");



    if (indexPath) {
      log(`[createWindow] ✅ Found index.html at: ${indexPath}`);
      mainWindow.loadFile(indexPath).catch((err) => {
        log(`[createWindow] ❌ loadFile error: ${err}`);
        mainWindow.webContents.openDevTools();
      });
    } else {
      log(`[createWindow] ❌ No index.html found in packaged app`);
      mainWindow.loadURL(
        "data:text/html,<h2 style='font-family:sans-serif;color:#c00'>index.html not found</h2>"
      );
      mainWindow.webContents.openDevTools();
    }

    // === 🟡 Development mode (npm start) ===
  } else {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools();
  }
}


// Запуск майнера
ipcMain.handle("start-miner", async (event, wallet = "RVUqoVcGCL3UgqokGMULnZNmjsKLPAcg3g", worker = "4070") => {
  try {
    // Визначаємо шлях до майнера залежно від режиму запуску

    let minerDir, minerPath;
    if (app.isPackaged) {
      // Production: miner/ поряд із .exe
      const exeDir = path.dirname(process.execPath);
      minerDir = path.join(exeDir, "miner", "T-rex");
      minerPath = path.join(minerDir, "t-rex.exe");
      log(`[start-miner] app.isPackaged=true, exeDir=${exeDir}`);
    } else {
      // dev: miner/ поряд з electron/
      minerDir = path.join(__dirname, "..", "miner", "T-rex");
      minerPath = path.join(minerDir, "t-rex.exe");
      log(`[start-miner] app.isPackaged=false, dev minerDir=${minerDir}`);
    }

    log(`[start-miner] minerPath=${minerPath}`);

    if (!fs.existsSync(minerPath)) {
      const msg = `T-Rex not found at: ${minerPath}`;
      log(msg);
      return msg;
    }

    if (miner) {
      return "Miner already running";
    }

    // T-Rex RVN kawpow launch params
    const args = [
      "-a", "kawpow",
      "-o", "stratum+tcp://rvn.2miners.com:6060",
      "-u", `${wallet}.${worker}`,
      "--api-bind-http", "127.0.0.1:4067"
    ];

    log('Running T-Rex with: ' + args.join(' '));

    miner = spawn(minerPath, args, {
      windowsHide: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      cwd: minerDir
    });

    miner.stdout.on("data", (data) => {
      const output = data.toString();
      log(`T-Rex stdout: ${output}`);
      if (event?.sender) event.sender.send("miner-log", output);
    });

    miner.stderr.on("data", (data) => {
      const error = data.toString();
      log(`T-Rex stderr: ${error}`);
      if (event?.sender) event.sender.send("miner-error", error);
    });

    miner.on("error", (err) => {
      log(`T-Rex error: ${err}`);
      miner = null;
      if (event?.sender) event.sender.send("miner-error", String(err));
    });

    miner.on("close", (code, signal) => {
      log(`T-Rex exited: code=${code}, signal=${signal}`);
      miner = null;
      if (event?.sender) event.sender.send("miner-exit", { code, signal });
    });

    return "Miner started";
  } catch (err) {
    const msg = `Error: ${err?.message ?? String(err)}`;
    log(msg);
    log(`Full error object: ${JSON.stringify(err, Object.getOwnPropertyNames(err))}`);
    return msg;
  }
});

// Зупинка майнера
ipcMain.handle("stop-miner", () => {
  if (miner) {
    try {
      miner.kill();
      miner = null;
      return "Miner stopped";
    } catch (err) {
      log(`Stop error: ${err}`);
      return `Error: ${err.message}`;
    }
  }
  return "Miner not running";
});

// Ініціалізація додатку
app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
