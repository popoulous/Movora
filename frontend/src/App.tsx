import { useEffect, useState } from "react";

interface Health {
  status: string;
  app: string;
  version: string;
}

export function App(): JSX.Element {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/health")
      .then((response) => response.json() as Promise<Health>)
      .then(setHealth)
      .catch((reason: unknown) => setError(String(reason)));
  }, []);

  return (
    <main>
      <h1>Movora</h1>
      {health ? (
        <p>
          {health.app} {health.version} — backend {health.status}
        </p>
      ) : error ? (
        <p>Backend unreachable: {error}</p>
      ) : (
        <p>Checking backend…</p>
      )}
    </main>
  );
}
