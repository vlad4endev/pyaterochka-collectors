import { useEffect, useState, type FormEvent } from "react";
import { PageHeader } from "../components/PageHeader";
import { api } from "../lib/api";
import { errorMessage } from "../lib/format";
import { useApiQuery } from "../lib/useApi";
import { useSession } from "../session";

const EXAMPLE_KG = 10;

export function SettingsPage() {
  const { token, refreshData } = useSession();
  const { data: settings } = useApiQuery(
    Boolean(token),
    () => api.settings.get(token ?? ""),
    [token],
  );

  const [kgRate, setKgRate] = useState("20");
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
    setKgRate(String(settings.kgRateRub ?? 20));
    setBank(settings.bank);
    setPayTo(settings.payTo);
    setDeadlineText(settings.deadlineText);
    setWindowStart(String(settings.windowStart));
    setWindowEnd(String(settings.windowEnd));
  }, [settings]);

  const rateNum = Number(kgRate.replace(",", "."));
  const rateOk = Number.isFinite(rateNum) && rateNum > 0;
  const exampleRub = rateOk ? Math.round(EXAMPLE_KG * rateNum) : null;

  async function onSave(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setToast(null);
    if (!rateOk) {
      setError("Укажите цену за кг больше нуля");
      return;
    }
    setBusy(true);
    try {
      await api.settings.update(token ?? "", {
        kgRateRub: rateNum,
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
        sub="Цена за кг, реквизиты для выплат и окно приёма"
        actions={
          <button className="btn-primary" type="submit" disabled={busy}>
            {busy ? "Сохраняем…" : "Сохранить"}
          </button>
        }
      />

      <div className="card rate-card">
        <h2>Цена за килограмм</h2>
        <p className="h2-sub">
          Когда магазин поднимает цену — поменяйте здесь. Новая ставка сразу действует на текущую
          неделю и все следующие. Уже оплаченные недели остаются со старой ценой.
        </p>
        <label htmlFor="sRate">Сколько рублей за 1 кг</label>
        <div className="rate-input-row">
          <input
            id="sRate"
            className="rate-input"
            type="number"
            min="1"
            step="1"
            inputMode="numeric"
            value={kgRate}
            onChange={(event) => setKgRate(event.target.value)}
            required
          />
          <span className="rate-input-suffix">₽/кг</span>
        </div>
        {exampleRub !== null ? (
          <p className="rate-example">
            Например, {EXAMPLE_KG} кг × {rateNum} ₽ = {exampleRub} ₽
          </p>
        ) : (
          <p className="rate-example">Укажите цену больше нуля</p>
        )}
      </div>

      <div className="card">
        <h2>Выплаты</h2>
        <p className="h2-sub">Эти данные уходят участникам в счёте.</p>
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
        Бот, мини-приложение и групповой чат — в разделах Telegram и MAX. Пароль админки хранится в{" "}
        <code>.env</code> как <code>ADMIN_PASSWORD</code>, не в базе.
      </div>
      {error ? <div className="err">{error}</div> : null}
      {toast ? <div className="toast">{toast}</div> : null}
    </form>
  );
}
