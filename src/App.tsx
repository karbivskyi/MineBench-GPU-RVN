import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from "recharts";

interface StatsPoint {
  time: string;
  hashrate: number;
  temp: number;
  power: number; // 🟢 нове поле
}

const App: React.FC = () => {
  const [wallet, setWallet] = useState("RVUqoVcGCL3UgqokGMULnZNmjsKLPAcg3g");
  const [worker, setWorker] = useState("4070");
  const [status, setStatus] = useState("stopped");
  const [history, setHistory] = useState<StatsPoint[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [duration, setDuration] = useState<number>(30); // seconds
  const [remaining, setRemaining] = useState<number | null>(null);
  const [results, setResults] = useState<{ avg: number; max: number; samples: number } | null>(null);
  const statsRef = useRef<number[]>([]);
  const deviceStatsRef = useRef<Record<string, number[]>>({});
  const deviceNamesRef = useRef<Record<string, string>>({});
  const [deviceResults, setDeviceResults] = useState<Array<{ rig_id: string; name: string; avg: number; max: number; samples: number }>>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const statsIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isStoppingRef = useRef(false);
  const latestHashrate = history.length > 0 ? history[history.length - 1].hashrate : 0;
  const unit = useMemo(() => getHashrateUnit(latestHashrate), [latestHashrate]);
  const normalizedHistory = useMemo(
    () => history.map(pt => ({
      ...pt,
      hashrate: normalizeHashrate(pt.hashrate),
    })),
    [history]
  );
  const powerStatsRef = useRef<number[]>([]);



  const addLog = (message: string) => {
    setLog(prev => [...prev.slice(-100), `${new Date().toLocaleTimeString()} - ${message}`]);
  };
  function getHashrateUnit(hr: number) {
    if (hr >= 1e9) return "GH/s";
    if (hr >= 1e6) return "MH/s";
    if (hr >= 1e3) return "KH/s";
    return "H/s";
  }
  function normalizeHashrate(hr: number) {
    if (hr >= 1e9) return hr / 1e9;
    if (hr >= 1e6) return hr / 1e6;
    if (hr >= 1e3) return hr / 1e3;
    return hr;
  }
  const startMiner = async () => {
    try {
      const res = await window.electron.invoke("start-benchmark", wallet, worker);
      setStatus(res);
      addLog("Benchmark started");
      // reset stats
      statsRef.current = [];
      deviceStatsRef.current = {};
      deviceNamesRef.current = {};
      setDeviceResults([]);
      setResults(null);
      setRemaining(duration);
      // start auto-stop timer
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        setRemaining(r => {
          if (r === null) return null;
          if (r <= 1) {
            stopMiner();
            if (timerRef.current) clearInterval(timerRef.current);
            return null;
          }
          return r - 1;
        });
      }, 1000);
      // start stats polling
      if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);
      statsIntervalRef.current = setInterval(fetchStats, 5000);
    } catch (err) {
      console.error(err);
      setStatus("error");
      addLog("Error starting benchmark");
    }
  };

  const stopMiner = async () => {
    if (isStoppingRef.current) return;
    isStoppingRef.current = true;

    try {
      const samples = statsRef.current.length;
      let benchmarkData = undefined;
      if (samples > 0) {
        const sum = statsRef.current.reduce((a, b) => a + b, 0);
        const avg = sum / samples;
        const max = Math.max(...statsRef.current);
        const avgTemp = history.length
          ? history.reduce((a, b) => a + b.temp, 0) / history.length
          : null;

        const avgPower = powerStatsRef.current.length
          ? powerStatsRef.current.reduce((a, b) => a + b, 0) / powerStatsRef.current.length
          : null;
        setResults({ avg, max, samples });
        benchmarkData = { avg_hashrate: avg, max_hashrate: max, avg_temp: avgTemp, avg_power: avgPower };
      }
      // compute per-device results
      const perDevice: Array<{ rig_id: string; name: string; avg: number; max: number; samples: number }> = [];
      for (const rig_id of Object.keys(deviceStatsRef.current)) {
        const arr = deviceStatsRef.current[rig_id] || [];
        const samplesD = arr.length;
        if (samplesD === 0) continue;
        const sumD = arr.reduce((a, b) => a + b, 0);
        const avgD = sumD / samplesD;
        const maxD = Math.max(...arr);
        perDevice.push({ rig_id, name: deviceNamesRef.current[rig_id] || rig_id, avg: avgD, max: maxD, samples: samplesD });
      }
      if (perDevice.length > 0) setDeviceResults(perDevice);

      // Тепер один раз зупиняємо майнер
      const res = await window.electron.invoke("stop-benchmark", benchmarkData);
      setStatus(res);
      addLog("Benchmark stopped");

      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (statsIntervalRef.current) {
        clearInterval(statsIntervalRef.current);
        statsIntervalRef.current = null;
      }
      setRemaining(null);

    } catch (err) {
      console.error(err);
      setStatus("error");
      addLog("Error stopping benchmark");
    } finally {
      isStoppingRef.current = false;
    }
  };

  const fetchStats = async () => {
    if (status === "benchmark completed") return;
    try {
      const res = await fetch("http://127.0.0.1:4067/summary");
      const data = await res.json();

      if (data?.gpus && data.gpus.length > 0) {
        // handle multiple GPUs
        const points: StatsPoint[] = data.gpus.map((g: any, i: number) => {
          const hrRaw = (g.hashrate ?? g.hash ?? 0);
          const temp = g.temperature ?? g.temp ?? 0;
          const power = g.power ?? 0; // 🟢 беремо з API споживання (W)
          const hr = hrRaw; // конвертуємо перед додаванням
          return { time: new Date().toLocaleTimeString(), hashrate: hr, temp };
        });

        // append only the first GPU to history chart (keep chart simple)
        setHistory(prev => [...prev.slice(-20), points[0]]);

        // log and accumulate per-device stats
        points.forEach((pt, i) => {
          const g = data.gpus[i] || {};
          // derive device name from available fields
          const rawName = (g.name || g.model || g.device || `GPU${i}`).toString();
          const nameStr = Array.isArray(rawName) ? rawName.join(', ') : rawName;
          // sanitize rig_id: replace spaces and non-alphanum with underscore
          const rig_id = rawName.replace(/[^a-zA-Z0-9-_]/g, '_').replace(/\s+/g, '_');
          deviceNamesRef.current[rig_id] = rawName;
          if (!deviceStatsRef.current[rig_id]) deviceStatsRef.current[rig_id] = [];
          deviceStatsRef.current[rig_id].push(pt.hashrate);
          // overall stats
          statsRef.current.push(pt.hashrate);
          powerStatsRef.current.push(pt.power); // 🟢 додали ват

          // 🔹 Відправляємо температуру та споживання у бекенд
          window.electron.invoke("report-stats", {
            temp: g.temperature ?? g.temp ?? null,
            power: g.power ?? null, // ⚡ споживання у ватах
          });
          addLog(`Benchmark ${nameStr}: ${formatHashrate(pt.hashrate)}, Temp: ${pt.temp}°C`);
        });
      }
    } catch {
      addLog("Waiting for benchmark stats...");
    }
  };

  // функція для відображення хешрейту у зручній одиниці
  function formatHashrate(hr: number) {
    if (hr >= 1e9) return (hr / 1e9).toFixed(2) + ' GH/s';
    if (hr >= 1e6) return (hr / 1e6).toFixed(2) + ' MH/s';
    if (hr >= 1e3) return (hr / 1e3).toFixed(2) + ' KH/s';
    return hr.toFixed(2) + ' H/s';
  }

  // Remove old polling effect, now handled by start/stop

  return (
    <div style={{ padding: 20 }}>
      <div>
        <h1>MineBench-GPU</h1>
        <h2>RVN coin</h2>
      </div>

      <div style={{ margin: "10px 0" }}>
        <label style={{ marginRight: 10 }}>
          Duration:
          <select value={duration} onChange={e => setDuration(Number(e.target.value))} style={{ marginLeft: 8 }}>
            <option value={30}>30s</option>
            <option value={60}>1m</option>
            <option value={300}>5m</option>
            <option value={600}>10m</option>
            <option value={3600}>1h</option>
          </select>
        </label>
        {/* <input
          value={wallet}
          onChange={e => setWallet(e.target.value)}
          placeholder="Wallet"
          style={{ marginRight: 10 }}
        />
        <input
          value={worker}
          onChange={e => setWorker(e.target.value)}
          placeholder="Worker"
          style={{ marginRight: 10 }}
        /> */}
        <button onClick={startMiner} style={{ marginRight: 5 }}>Start Benchmark</button>
        <button onClick={stopMiner}>Stop Benchmark</button>
        <p>Status: {status} {remaining !== null && ` - Remaining: ${remaining}s`}</p>
      </div>

      {history.length > 0 && (
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={normalizedHistory}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="time" />
            <YAxis
              yAxisId="left"
              label={{ key: unit, value: unit, angle: -90, position: "insideLeft" }}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              label={{ value: "°C", angle: -90, position: "insideRight" }}
            />
            <Tooltip />
            <Legend />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="hashrate"
              stroke="#4ade80"
              name="Hashrate"
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="temp"
              stroke="#f87171"
              name="Temp (°C)"
            />
          </LineChart>
        </ResponsiveContainer>
      )}

      <div
        style={{
          marginTop: 20,
          height: 200,
          overflowY: "auto",
          backgroundColor: "#111",
          color: "#0f0",
          padding: 10,
          fontFamily: "monospace"
        }}
      >
        {log.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>
      {results && (
        <div style={{ marginTop: 12 }}>
          <h3>Results</h3>
          <div>Samples: {results.samples}</div>
          <div>Average Hashrate: {formatHashrate(results.avg)}</div>
          <div>Max Hashrate: {formatHashrate(results.max)}</div>
        </div>
      )}
    </div>
  );
};

export default App;
