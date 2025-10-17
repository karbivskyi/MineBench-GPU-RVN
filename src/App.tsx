import React, { useState, useEffect } from "react";
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
  const [wallet, setWallet] = useState("nexa:nqtsq5g59fu9g23fkdgfmxpsatwekq6wv6wmn66g20srq2dk");
  const [worker, setWorker] = useState("4070");
  const [status, setStatus] = useState("stopped");
  const [history, setHistory] = useState<StatsPoint[]>([]);
  const [log, setLog] = useState<string[]>([]);

  const addLog = (message: string) => {
    setLog(prev => [...prev.slice(-100), `${new Date().toLocaleTimeString()} - ${message}`]);
  };

  const startMiner = async () => {
    try {
      const res = await window.electron.invoke("start-miner", wallet, worker);
      setStatus(res);
      addLog("Miner started");
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

      if (data?.gpus?.[0]) {
        const point: StatsPoint = {
          time: new Date().toLocaleTimeString(),
          hashrate: data.gpus[0].hashrate / 1e6, // H/s -> MH/s
          temp: data.gpus[0].temperature
        };
        setHistory(prev => [...prev.slice(-20), point]);
        addLog(`Miner: ${point.hashrate.toFixed(2)} MH/s, Temp: ${point.temp}°C`);
      }
    } catch {
      addLog("Waiting for miner stats...");
    }
  };

  const fetchPoolStats = async () => {
    try {
      const res = await fetch(`https://api.2miners.com/v2/nexa/miner/${wallet}`);
      const data = await res.json();

      if (data?.stats) {
        addLog(`Pool Stats - Hashrate: ${(data.stats.hashrate / 1e6).toFixed(2)} MH/s, Paid: ${(data.paid / 1e6).toFixed(6)} NEXA`);
      }
    } catch {
      addLog("Error fetching pool stats");
    }
  };

  useEffect(() => {
    const minerInterval = setInterval(fetchStats, 5000);
    const poolInterval = setInterval(fetchPoolStats, 15000);
    return () => {
      clearInterval(minerInterval);
      clearInterval(poolInterval);
    };
  }, [wallet]);

  return (
    <div style={{ padding: 20 }}>
      <h1>MineBench-GPU</h1>
      <h2>RVN coin</h2>

      <div style={{ margin: "10px 0" }}>
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
        <p>Status: {status}</p>
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
    </div>
  );
};

export default App;
