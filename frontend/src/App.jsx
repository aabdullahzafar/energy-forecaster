import { useEffect, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import "./App.css";

const API = "http://127.0.0.1:8000";

function App() {
  const [chartData, setChartData] = useState([]);
  const [anomalies, setAnomalies] = useState([]);
  const [file, setFile] = useState(null);
  const [message, setMessage] = useState("");

  async function loadChart() {
    const history = await fetch(`${API}/history?hours=168`).then((r) => r.json());
    const forecast = await fetch(`${API}/forecast?hours=48`).then((r) => r.json());

    const past = history.map((row) => ({ time: row.timestamp, actual: row.usage_kw }));
    const future = forecast.map((row) => ({ time: row.timestamp, forecast: row.predicted_kw }));

    setChartData([...past, ...future]);
  }

  async function loadAnomalies() {
    const data = await fetch(`${API}/anomalies?days=30`).then((r) => r.json());
    setAnomalies(data.reverse());
  }
  
  async function handleUpload() {
    if (!file) {
      setMessage("Please choose a CSV file first.");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(`${API}/upload`, { method: "POST", body: formData });
    const result = await response.json();

    if (response.ok) {
      setMessage(`Added ${result.rows_added} new rows, skipped ${result.rows_skipped}.`);
      loadChart();
      loadAnomalies();
    } else {
      setMessage(`Error: ${result.detail}`);
    }
  }

  useEffect(() => {
    loadChart();
    loadAnomalies();
  }, []);

  return (
    <div className="page">
      <h1>⚡ Smart Energy Forecaster</h1>
      
      <div className="card">
        <h2>Upload new readings</h2>
        <p className="hint">CSV with two columns: timestamp, usage_kw (one row per hour)</p>
        <input type="file" accept=".csv" onChange={(e) => setFile(e.target.files[0])} />
        <button onClick={handleUpload}>Upload</button>
        {message && <p>{message}</p>}
      </div>

      <div className="card">
        <h2>Usage: last 7 days and next 48 hours</h2>
        <ResponsiveContainer width="100%" height={350}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="time" tickFormatter={(t) => t.slice(5, 10)} minTickGap={40} />
            <YAxis unit=" kW" />
            <Tooltip />
            <Legend />
            <Line dataKey="actual" name="Past usage" stroke="#2563eb" dot={false} />
            <Line dataKey="forecast" name="Forecast" stroke="#f97316" strokeDasharray="5 5" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="card">
        <h2>Unusual readings (last 30 days)</h2>
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Type</th>
              <th>Actual</th>
              <th>Expected</th>
              <th>Difference</th>
            </tr>
          </thead>
          <tbody>
            {anomalies.map((a) => (
              <tr key={a.timestamp}>
                <td>{a.timestamp}</td>
                <td className={a.type}>{a.type === "spike" ? "🔺 Spike" : "🔻 Drop"}</td>
                <td>{a.actual_kw} kW</td>
                <td>{a.predicted_kw} kW</td>
                <td>{a.error_kw > 0 ? "+" : ""}{a.error_kw} kW</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default App;