export async function fetchJSON(input: RequestInfo | URL, init?: RequestInit) {
  return fetch(input, { credentials: "include", ...init });
}

export async function readJSON<T>(res: Response): Promise<T> {
  const txt = await res.text();
  return (txt ? JSON.parse(txt) : null) as T;
}

export async function postStatsEvent(event_type: string, meta?: unknown) {
  await fetchJSON("/api/stats/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event_type, meta }),
  });
}

