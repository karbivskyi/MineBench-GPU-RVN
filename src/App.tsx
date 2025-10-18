import React, { useState, useEffect, useRef } from "react";
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
}

const App: React.FC = () => {
  const [wallet, setWallet] = useState("RVUqoVcGCL3UgqokGMULnZNmjsKLPAcg3g");
  const [worker, setWorker] = useState("4070");
  const [status, setStatus] = useState("stopped");
  const [history, setHistory] = useState<StatsPoint[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [duration, setDuration] = useState<number>(30); // seconds
  const [remaining, setRemaining] = useState<number | null>(null);
  const [results, setResults] = useState<{avg: number; max: number; samples: number} | null>(null);
  const statsRef = useRef<number[]>([]);
  const deviceStatsRef = useRef<Record<string, number[]>>({});
  const deviceNamesRef = useRef<Record<string, string>>({});
  const [deviceResults, setDeviceResults] = useState<Array<{ rig_id: string; name: string; avg: number; max: number; samples: number }>>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const statsIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const addLog = (message: string) => {
    setLog(prev => [...prev.slice(-100), `${new Date().toLocaleTimeString()} - ${message}`]);
  };

  const startMiner = async () => {
    try {
      const res = await window.electron.invoke("start-miner", wallet, worker);
      setStatus(res);
      addLog("Miner started");
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
      addLog("Error starting miner");
    }
  };

  const stopMiner = async () => {
    try {
      const res = await window.electron.invoke("stop-miner");
      setStatus(res);
      addLog("Miner stopped");
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (statsIntervalRef.current) {
        clearInterval(statsIntervalRef.current);
        statsIntervalRef.current = null;
      }
      setRemaining(null);
      // compute aggregated results (overall)
      const samples = statsRef.current.length;
      if (samples > 0) {
        const sum = statsRef.current.reduce((a, b) => a + b, 0);
        const avg = sum / samples;
        const max = Math.max(...statsRef.current);
        setResults({ avg, max, samples });
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
    } catch (err) {
      console.error(err);
      setStatus("error");
      addLog("Error stopping miner");
    }
  };

  const fetchStats = async () => {
    try {
      const res = await fetch("http://127.0.0.1:4067/summary");
      const data = await res.json();

      if (data?.gpus && data.gpus.length > 0) {
        // handle multiple GPUs
        const points: StatsPoint[] = data.gpus.map((g: any, i: number) => {
          const hr = (g.hashrate ?? g.hash ?? 0) / 1e6; // try several keys
          const temp = g.temperature ?? g.temp ?? 0;
          return { time: new Date().toLocaleTimeString(), hashrate: hr, temp };
        });

        // append only the first GPU to history chart (keep chart simple)
        setHistory(prev => [...prev.slice(-20), points[0]]);

        // log and accumulate per-device stats
        points.forEach((pt, i) => {
          const g = data.gpus[i] || {};
          // derive device name from available fields
          const rawName = (g.name || g.model || g.device || `GPU${i}`).toString();
          // sanitize rig_id: replace spaces and non-alphanum with underscore
          const rig_id = rawName.replace(/[^a-zA-Z0-9-_]/g, '_').replace(/\s+/g, '_');
          deviceNamesRef.current[rig_id] = rawName;
          if (!deviceStatsRef.current[rig_id]) deviceStatsRef.current[rig_id] = [];
          deviceStatsRef.current[rig_id].push(pt.hashrate);
          // overall stats
          statsRef.current.push(pt.hashrate);
          addLog(`Miner [${rig_id}]: ${pt.hashrate.toFixed(2)} MH/s, Temp: ${pt.temp}°C`);
        });
      }
    } catch {
      addLog("Waiting for miner stats...");
    }
  };

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
          <LineChart data={history}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="time" />
            <YAxis
              yAxisId="left"
              label={{ value: "MH/s", angle: -90, position: "insideLeft" }}
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
              name="Hashrate (MH/s)"
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
          <div>Average Hashrate: {results.avg.toFixed(2)} MH/s</div>
          <div>Max Hashrate: {results.max.toFixed(2)} MH/s</div>
        </div>
      )}
    </div>
  );
};

export default App;
