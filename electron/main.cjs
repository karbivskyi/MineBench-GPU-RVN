const fs = require("fs");

ipcMain.handle("start-miner", async () => {
  const minerPath = path.join(__dirname, "miner", "Gminer", "miner.exe");

  // Перевіряємо, чи існує файл майнера
  if (!fs.existsSync(minerPath)) {
    console.error(`Miner not found at: ${minerPath}`);
    return `Miner not found at: ${minerPath}`;
  }

  // Запуск майнера
  miner = spawn(minerPath, [
    "--algo", "kawpow",
    "--pool", "rvn.2miners.com:6060",
    "--user", `RVUqoVcGCL3UgqokGMULnZNmjsKLPAcg3g.4070`,
    "--apiport", "4067",
    "--dual-gpu" // якщо потрібна підтримка AMD + NVIDIA (залежить від версії Gminer)
  ]);

  // Логування stdout
  miner.stdout.on("data", (data) => {
    const output = data.toString();
    console.log(`Miner: ${output}`);

    // Опціонально: парсимо рядки з інформацією про GPU
    if (output.includes("GPU")) {
      mainWindow.webContents.send("miner-log", output);
    }
  });

  // Логування stderr
  miner.stderr.on("data", (data) => console.error(`Error: ${data.toString()}`));

  // Обробка помилок запуску
  miner.on("error", (err) => console.error(`Failed to start miner: ${err}`));

  // Закриття процесу
  miner.on("close", (code) => console.log(`Miner exited with code ${code}`));

  return "Miner started";
});
