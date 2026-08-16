import { useEffect, useState, type FormEvent } from "react";
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
  const [groupChatId, setGroupChatId] = useState("");
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
    setGroupChatId(settings.groupChatId ?? "");
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
        groupChatId: groupChatId.trim() || undefined,
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
      <h1 className="page-title">Настройки</h1>
      <div className="page-sub">Реквизиты, окно приёма и Telegram</div>

      <div className="card">
        <h2>Выплаты</h2>
        <div className="h2-sub">
          Ставка ₽/кг задаётся при создании периода и не меняется здесь — иначе старые кг пересчитаются задним числом.
        </div>
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
        <div className="field" style={{ maxWidth: 420 }}>
          <label htmlFor="sDeadline">Текст дедлайна</label>
          <input
            id="sDeadline"
            value={deadlineText}
            onChange={(event) => setDeadlineText(event.target.value)}
          />
        </div>
      </div>

      <div className="card">
        <h2>Окно приёма продуктов</h2>
        <div className="h2-sub">Показывается участнику таймером в его день</div>
        <div className="grid2">
          <div className="field">
            <label htmlFor="sWinStart">Начало</label>
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
            <label htmlFor="sWinEnd">Конец</label>
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

      <div className="card">
        <h2>Telegram-бот</h2>
        <div className="h2-sub">
          Бот отвечает на /start приветствием и кнопкой мини-приложения. Токен и URL задаются в{" "}
          <code>.env</code>: <code>BOT_TOKEN</code> и <code>MINIAPP_URL</code> (https). В BotFather
          поставь тот же URL как Menu Button.
        </div>
        <div className="field" style={{ maxWidth: 420 }}>
          <label htmlFor="sGroupChat">Chat ID группы для авто-отправки (необязательно)</label>
          <input
            id="sGroupChat"
            value={groupChatId}
            onChange={(event) => setGroupChatId(event.target.value)}
          />
        </div>
      </div>

      <div className="card">
        <h2>Доступ в админку</h2>
        <div className="h2-sub">
          Пароль хранится в <code>.env</code> как <code>ADMIN_PASSWORD</code>, не в базе.
        </div>
      </div>

      <button className="btn-primary" disabled={busy}>
        Сохранить
      </button>
      {error ? <div className="err">{error}</div> : null}
      {toast ? <div className="toast">{toast}</div> : null}
    </form>
  );
}
