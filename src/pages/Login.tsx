import { useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { errorMessage } from "../lib/format";
import { useSession } from "../session";

export function LoginPage() {
  const { setToken } = useSession();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await api.login(password);
      setToken(result.sessionToken);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={(event) => void onSubmit(event)}>
        <h1>Вход в админку</h1>
        <div className="sub">Пятёрка на бульваре</div>
        <div className="field">
          <label htmlFor="loginPass">Пароль</label>
          <input
            id="loginPass"
            type="password"
            autoComplete="current-password"
            placeholder="Пароль администратора"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <button className="btn-primary" style={{ width: "100%" }} disabled={busy || password.length < 1}>
          {busy ? "Входим…" : "Войти"}
        </button>
        {error ? <div className="err">{error}</div> : null}
        <div className="hint">
          Пароль задаётся в <code>.env</code> как <code>ADMIN_PASSWORD</code>. Админка работает отдельно от Telegram-бота.
        </div>
      </form>
    </div>
  );
}
