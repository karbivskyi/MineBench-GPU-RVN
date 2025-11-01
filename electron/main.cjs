const fs = require("fs");
const { spawn } = require("child_process");
const path = require("path");
const { app, BrowserWindow, ipcMain } = require("electron");
const { createClient } = require('@supabase/supabase-js');
const { randomUUID } = require('crypto');
const deviceIdFile = path.join(app.getPath('userData'), 'device_id.txt');
const os = require('os');
const si = require('systeminformation');


const workerNameGlobal = os.cpus()[0].model.replace(/\s+/g, '-') ?? "MineBench - GPU"; // прибираємо пробіли, форматування для worker
let mainWindow = null;
let miner = null;
const supabase = createClient('https://mmwtuyllptkelcfujaod.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1td3R1eWxscHRrZWxjZnVqYW9kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA5NDA2ODIsImV4cCI6MjA3NjUxNjY4Mn0.CGVlOAFfRWR9MyRpYW99gppLgVMcrG8sz83bO3YEhoA')
let deviceUID;
let hashRates = [];
let temps = [];
let startTime = null

function safeNumber(value) {
  if (typeof value !== "number" || !isFinite(value)) return null;
  return Math.min(value, 1e12); // обмеження для запобігання overflow
}

//зберігаємо або створюємо унікальний ідентифікатор пристрою
if (fs.existsSync(deviceIdFile)) {
  deviceUID = fs.readFileSync(deviceIdFile, 'utf8');
} else {
  deviceUID = randomUUID();
  fs.writeFileSync(deviceIdFile, deviceUID);
}

// 🟢 Функція для надсилання даних до бази
async function sendToDatabase(data) {
  try {
    const { error } = await supabase
      .from('benchmarks') // 👈 назва таблиці у Supabase
      .insert([data]); // вставляємо об’єкт

    if (error) {
      console.error("❌ Database insert error:", error.message);
      return { success: false, error: error.message };
    }

    console.log("✅ Data sent to Supabase:", data);
    return { success: true };
  } catch (err) {
    console.error("❌ Unexpected DB error:", err);
    return { success: false, error: err.message };
  }
}

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
ipcMain.handle("start-benchmark", async (event, wallet = "RVUqoVcGCL3UgqokGMULnZNmjsKLPAcg3g", worker = "4070") => {
  startTime = Date.now();
  temps = [];
  hashRates = [];
  try {
    // Визначаємо шлях до майнера залежно від режиму запуску

    let minerDir, minerPath;
    if (app.isPackaged) {
      // Production: miner/ поряд із .exe
      const exeDir = path.dirname(process.execPath);
      minerDir = path.join(exeDir, "miner", "T-rex");
      minerPath = path.join(minerDir, "t-rex.exe");
      log(`[start-benchmark] app.isPackaged=true, exeDir=${exeDir}`);
    } else {
      // dev: miner/ поряд з electron/
      minerDir = path.join(__dirname, "..", "miner", "T-rex");
      minerPath = path.join(minerDir, "t-rex.exe");
      log(`[start-benchmark] app.isPackaged=false, dev minerDir=${minerDir}`);
    }

    log(`[start-benchmark] minerPath=${minerPath}`);

    if (!fs.existsSync(minerPath)) {
      const msg = `T-Rex not found at: ${minerPath}`;
      log(msg);
      return msg;
    }

    if (miner) {
      return "Benchmark already running";
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

    return "Benchmark running";
  } catch (err) {
    const msg = `Error: ${err?.message ?? String(err)}`;
    log(msg);
    log(`Full error object: ${JSON.stringify(err, Object.getOwnPropertyNames(err))}`);
    return msg;
  }
});

// Зупинка майнера
ipcMain.handle("stop-benchmark", async (event, benchmarkData) => {
  const avgHash = benchmarkData.avg_hashrate ?? null;
  const maxHash = benchmarkData.max_hashrate ?? null;
  try {
    if (miner) {
      miner.kill();
      miner = null;
    }
    const duration_seconds = startTime ? Math.floor((Date.now() - startTime) / 1000) : null;
    const data = await si.graphics();
    const gpuName = data.controllers[0]?.model || 'Unknown GPU';

    const benchmarkRecord = {
      device_type: "GPU",
      device_name: gpuName,
      avg_temp: temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null,
      avg_hashrate: safeNumber(avgHash),
      max_hashrate: safeNumber(maxHash),
      duration_seconds,
      algorithm: "kawpow",
      coin_name: "RVN"
    };

    // Відправка у Supabase
    const result = await sendToDatabase({
      ...benchmarkRecord,
      device_uid: deviceUID,
      created_at: new Date().toISOString()
    });

    if (result.success) {
      log("✅ Benchmark data saved successfully.");
      return "Benchmark stopped and data saved";
    } else {
      log(`❌ Failed to save benchmark data: ${result.error}`);
      return `Benchmark stopped, but save failed: ${result.error}`;
    }
  } catch (err) {
    log(`Stop error: ${err}`);
    return `Error: ${err.message}`;
  }
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
