"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IconEye, IconEyeOff, IconLock } from "@/components/icons";

export default function LoginForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      router.replace("/");
      router.refresh();
    } else {
      setError("Incorrect password. Please try again.");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="login__form">
      <label htmlFor="password" className="sr-only">Password</label>
      <div className={`field ${error ? "field--error" : ""}`}>
        <IconLock className="field__icon" />
        <input
          id="password"
          type={show ? "text" : "password"}
          placeholder="Access password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <button type="button" className="field__toggle" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"}>
          {show ? <IconEyeOff /> : <IconEye />}
        </button>
      </div>
      {error && <p className="login__error" role="alert">{error}</p>}
      <button type="submit" className="btn btn--primary btn--block" disabled={loading || !password}>
        {loading ? <span className="spinner" /> : "Enter vault"}
      </button>
    </form>
  );
}
