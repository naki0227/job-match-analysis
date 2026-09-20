import { useEffect, useState } from "react";
import "./App.css";

function App() {
  const [status, setStatus] = useState<string>("loading");

  useEffect(() => {
    async function checkHealth() {
      try {
        const response = await fetch("/api/health");
        const data = await response.json();

        setStatus(data.status);
      } catch {
        setStatus("error");
      }
    }

    checkHealth();
  }, []);

  return (
    <main>
      <p>API Status: {status}</p>
    </main>
  );
}

export default App;
