import { useEffect, useState, type FormEvent } from "react";
import { PageHeader } from "../components/PageHeader";
import { api } from "../lib/api";
import { errorMessage } from "../lib/format";
import { useApiQuery } from "../lib/useApi";
import { useSession } from "../session";

export function SettingsPage() {
  const { token, refreshData } = useSession();
  const { data: settings } = useApiQuery(
    Boolean(token),
    () => api.settings.get(token ?? ""),
    [token],
  );

  const [bank, setBank] = useState("");
  const [payTo, setPayTo] = useState("");
  const [deadlineText, setDeadlineText] = useState("");
  const [windowStart, setWindowStart] = useState("17");
  const [windowEnd, setWindowEnd] = useState("21");
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!settings) {
      return;
    }
    setBank(settings.bank);
    setPayTo(settings.payTo);
    setDeadlineText(settings.deadlineText);
    setWindowStart(String(settings.windowStart));
    setWindowEnd(String(settings.windowEnd));
  }, [settings]);

  async function onSave(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setToast(null);
    setBusy(true);
    try {
      await api.settings.update(token ?? "", {
        bank,
        payTo,
        deadlineText,
        windowStart: Number(windowStart),
        windowEnd: Number(windowEnd),
      });
      refreshData();
      setToast("Сохранено ✓");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (settings === undefined) {
    return <div className="loading">Загрузка…</div>;
  }

  return (
    <form onSubmit={(event) => void onSave(event)}>
      <PageHeader
        title="Настройки"
        sub="Реквизиты для выплат и окно приёма продуктов"
        actions={
          <button className="btn-primary" type="submit" disabled={busy}>
            {busy ? "Сохраняем…" : "Сохранить"}
          </button>
        }
      />

      <div className="card">
        <h2>Выплаты</h2>
        <p className="h2-sub">
          Эти данные уходят участникам в счёте. Ставка ₽/кг задаётся у открытой недели в шапке — иначе
          старые кг пересчитаются задним числом.
        </p>
        <div className="grid2">
          <div className="field">
            <label htmlFor="sBank">Банк</label>
            <input id="sBank" value={bank} onChange={(event) => setBank(event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="sCard">Номер карты / счёта</label>
            <input id="sCard" value={payTo} onChange={(event) => setPayTo(event.target.value)} />
          </div>
        </div>
        <div className="field" style={{ maxWidth: 480 }}>
          <label htmlFor="sDeadline">Текст дедлайна</label>
          <input
            id="sDeadline"
            value={deadlineText}
            onChange={(event) => setDeadlineText(event.target.value)}
          />
        </div>
      </div>

      <div className="card">
        <h2>Окно приёма</h2>
        <p className="h2-sub">Показывается участнику таймером в его день, в мини-приложении</p>
        <div className="grid2">
          <div className="field">
            <label htmlFor="sWinStart">Начало, часы</label>
            <input
              id="sWinStart"
              type="number"
              min="0"
              max="23"
              value={windowStart}
              onChange={(event) => setWindowStart(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="sWinEnd">Конец, часы</label>
            <input
              id="sWinEnd"
              type="number"
              min="0"
              max="23"
              value={windowEnd}
              onChange={(event) => setWindowEnd(event.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="note-card">
        Бот, мини-приложение и групповой чат — в разделе Telegram. Пароль админки хранится в{" "}
        <code>.env</code> как <code>ADMIN_PASSWORD</code>, не в базе.
      </div>
      {error ? <div className="err">{error}</div> : null}
      {toast ? <div className="toast">{toast}</div> : null}
    </form>
  );
}
