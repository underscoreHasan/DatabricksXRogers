"use client";

import { useState } from "react";

export default function Home() {
  const [message, setMessage] = useState("Ready to build.");
  const [loading, setLoading] = useState(false);

  async function checkApi() {
    setLoading(true);
    try {
      const response = await fetch("/api/health");
      if (!response.ok) throw new Error("Request failed");
      const data = await response.json();
      setMessage(data.message);
    } catch {
      setMessage("Could not reach the backend. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-xl px-6 py-20">
      <h1 className="text-3xl font-semibold">Next.js + React</h1>
      <p className="my-4" role="status">{message}</p>
      <button
        className="cursor-pointer rounded-lg bg-foreground px-4 py-3 text-background disabled:cursor-wait disabled:opacity-60"
        onClick={checkApi}
        disabled={loading}
      >
        {loading ? "Checking…" : "Check backend"}
      </button>
    </main>
  );
}
