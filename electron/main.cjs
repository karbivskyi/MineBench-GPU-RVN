const { app, BrowserWindow, ipcMain } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const waitOn = require("wait-on");

let mainWindow;
let miner;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js")
    },
  });

  mainWindow.loadURL("../dist/index.html");
  mainWindow.webContents.openDevTools();
}

// Чекаємо, поки Electron готовий
app.whenReady().then(async () => {
  // Чекаємо Vite dev server
  await waitOn({ resources: ["../dist/index.html"], timeout: 30000 });
  createWindow();
});

// Start/Stop майнера
ipcMain.handle("start-miner", (event, wallet, worker) => {
  const minerPath = "D:\\Mining\\Setup\\AMD\\lolMiner.exe";

  miner = spawn(minerPath, [
    "--algo", "NEXA",
    "--pool", "nexa.2miners.com:5050",
    "--user", `${wallet}.${worker}`,
    "--apiport", "4067"
  ]);

  miner.stdout.on("data", (data) => console.log(`Miner: ${data}`));
  miner.stderr.on("data", (data) => console.error(`Error: ${data}`));
  miner.on("close", (code) => console.log(`Miner exited with code ${code}`));

  return "Miner started";
});

ipcMain.handle("stop-miner", () => {
  if (miner) {
    miner.kill();
    miner = null;
    return "Miner stopped";
  }
  return "Miner not running";
});

// Закриваємо всі вікна
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
