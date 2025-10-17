const fs = require("fs");
const { spawn } = require("child_process");
const path = require("path");
const { app, BrowserWindow, ipcMain } = require("electron");

let miner = null;

ipcMain.handle("start-miner", async (event, wallet = "RVUqoVcGCL3UgqokGMULnZNmjsKLPAcg3g", worker = "4070") => {
  try {
    // __dirname -> папка де electron.cjs знаходиться (наприклад: .../project/electron)
    // miner знаходиться на одному рівні з electron: .../project/miner/Gminer/miner.exe
    const minerPath = "/miner/Gminer/miner.exe";

    if (!fs.existsSync(minerPath)) {
      const msg = `Miner not found at: ${minerPath}`;
      console.error(msg);
      return msg;
    }

    // Якщо процес вже запущений — повідомляємо
    if (miner) {
      return "Miner already running";
    }

    // Параметри запуску для Gminer (kawpow / RVN)
    const args = [
      "--algo", "kawpow",
      "--server", "rvn.2miners.com",
      "--port", "6060",
      "--user", `${wallet}.${worker}`,
      "--api", "0.0.0.0:4067" // робимо веб-інтерфейс доступним локально
    ];

    miner = spawn(minerPath, args, { windowsHide: true });

    miner.stdout.on("data", (data) => {
      const output = data.toString();
      console.log(`Miner stdout: ${output}`);
      // пересилаємо логи в рендерер (UI)
      if (event && event.sender) {
        event.sender.send("miner-log", output);
      }
    });

    miner.stderr.on("data", (data) => {
      const error = data.toString();
      console.error(`Miner stderr: ${error}`);
      if (event && event.sender) event.sender.send("miner-error", error);
    });

    miner.on("error", (err) => {
      console.error("Failed to start miner:", err);
      miner = null;
      if (event && event.sender) event.sender.send("miner-error", String(err));
    });

    miner.on("close", (code, signal) => {
      console.log(`Miner exited with code ${code} signal ${signal}`);
      miner = null;
      if (event && event.sender) event.sender.send("miner-exit", { code, signal });
    });

    return "Miner started";
  } catch (err) {
    console.error("start-miner exception:", err);
    return `Error starting miner: ${err?.message ?? String(err)}`;
  }
});

ipcMain.handle("stop-miner", () => {
  if (miner) {
    try {
      miner.kill();
      miner = null;
      return "Miner stopped";
    } catch (err) {
      console.error("Error stopping miner:", err);
      return `Error stopping miner: ${err?.message ?? String(err)}`;
    }
  }
  return "Miner not running";
});
