import { useEffect, useState, type FormEvent } from "react";
import { PageHeader } from "../components/PageHeader";
import { api, type TelegramStatus } from "../lib/api";
import { errorMessage } from "../lib/format";
import { useApiQuery } from "../lib/useApi";
import { useSession } from "../session";

export function TelegramPage() {
  const { token } = useSession();
  const { data, reload } = useApiQuery(
    Boolean(token),
    () => api.telegram.get(token ?? ""),
    [token],
  );

  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [botToken, setBotToken] = useState("");
  const [miniAppUrl, setMiniAppUrl] = useState("");
  const [urlReady, setUrlReady] = useState(false);
  const [groupChatId, setGroupChatId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState<"bot" | "clear" | "chat" | "unlink" | "test" | null>(
    null,
  );

  useEffect(() => {
    if (!data) {
      return;
    }
    setStatus(data);
    if (!urlReady) {
      setMiniAppUrl(data.miniAppUrl ?? "");
      setUrlReady(true);
    }
  }, [data, urlReady]);

  useEffect(() => {
    if (!status?.botRunning || status.groupChatId) {
      return;
    }
    const timer = window.setInterval(() => {
      reload();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [status?.botRunning, status?.groupChatId, reload]);

  const current = status ?? data;

  async function onSaveBot(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setToast(null);
    setBusy("bot");
    try {
      const next = await api.telegram.saveBot(token ?? "", {
        botToken: botToken.trim() || undefined,
        miniAppUrl,
      });
      setStatus(next);
      setBotToken("");
      setMiniAppUrl(next.miniAppUrl ?? "");
      setToast("Настройки бота сохранены ✓");
      reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function onClearToken() {
    if (!window.confirm("Удалить токен бота из базы? Бот остановится, если его нет в .env.")) {
      return;
    }
    setError(null);
    setToast(null);
    setBusy("clear");
    try {
      const next = await api.telegram.clearBot(token ?? "");
      setStatus(next);
      setBotToken("");
      setToast("Токен удалён");
      reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function onLinkChat(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setToast(null);
    setBusy("chat");
    try {
      const next = await api.telegram.linkChat(token ?? "", groupChatId.trim());
      setStatus(next);
      setGroupChatId("");
      setToast("Чат привязан ✓");
      reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function onUnlink() {
    if (!window.confirm("Отвязать группу от админки?")) {
      return;
    }
    setError(null);
    setToast(null);
    setBusy("unlink");
    try {
      const next = await api.telegram.unlinkChat(token ?? "");
      setStatus(next);
      setToast("Чат отвязан");
      reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function onTest() {
    setError(null);
    setToast(null);
    setBusy("test");
    try {
      await api.telegram.test(token ?? "");
      setToast("Тестовое сообщение отправлено в группу ✓");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  if (!current) {
    return <div className="loading">Загрузка…</div>;
  }

  const botLabel = current.botUsername ? `@${current.botUsername}` : null;

  return (
    <div>
      <PageHeader
        title="Telegram"
        sub="Бот, мини-приложение и групповой чат — без правки .env"
      />

      <form className="card" onSubmit={(event) => void onSaveBot(event)}>
        <h2>Бот</h2>
        <div className="h2-sub">
          Токен берётся у <code>@BotFather</code>. После сохранения бот запускается сам.
        </div>
        <div className="status-line">
          {current.botRunning ? (
            <span className="badge ok">{botLabel ? `работает ${botLabel}` : "бот работает"}</span>
          ) : current.botTokenSet ? (
            <span className="badge warn">токен есть, бот не запущен</span>
          ) : (
            <span className="badge warn">не настроен</span>
          )}
          {current.botTokenSource === "env" ? (
            <span className="badge info">сейчас из .env</span>
          ) : null}
        </div>
        <div className="field" style={{ maxWidth: 520 }}>
          <label htmlFor="tgToken">Токен бота</label>
          <input
            id="tgToken"
            type="password"
            autoComplete="off"
            placeholder={
              current.botTokenSet
                ? "Токен сохранён — введите новый, чтобы заменить"
                : "123456789:AAH..."
            }
            value={botToken}
            onChange={(event) => setBotToken(event.target.value)}
          />
        </div>
        <div className="field" style={{ maxWidth: 520 }}>
          <label htmlFor="tgMiniApp">URL мини-приложения (https)</label>
          <input
            id="tgMiniApp"
            type="url"
            placeholder="https://example.com"
            value={miniAppUrl}
            onChange={(event) => setMiniAppUrl(event.target.value)}
          />
        </div>
        <div className="btn-row">
          <button className="btn-primary" disabled={busy !== null}>
            {busy === "bot" ? "Сохраняем…" : "Сохранить бота"}
          </button>
          {current.botTokenSource === "database" ? (
            <button
              type="button"
              className="btn-secondary"
              disabled={busy !== null}
              onClick={() => void onClearToken()}
            >
              {busy === "clear" ? "Удаляем…" : "Удалить токен"}
            </button>
          ) : null}
        </div>
      </form>

      <div className="note-card">
        Каждый день в 10:00 по Москве бот пишет в личку тем, у кого в открытой неделе есть пропуск за
        уже прошедшие дни. Сегодняшняя смена не считается пропуском до завтра. Нужны Telegram ID и хотя
        бы один /start у бота.
      </div>

      <div className="card">
        <h2>Групповой чат</h2>
        <div className="h2-sub">
          Сюда уйдёт сводка из админки. Бот должен быть добавлен в группу.
        </div>
        {current.groupChatId ? (
          <>
            <div className="status-line">
              <span className="badge ok">привязан</span>
            </div>
            <p className="chat-bound">
              {current.groupChatTitle ? <strong>{current.groupChatTitle}</strong> : "Группа"}
              <span className="chat-id">{current.groupChatId}</span>
            </p>
            <div className="btn-row">
              <button
                type="button"
                className="btn-primary"
                disabled={busy !== null}
                onClick={() => void onTest()}
              >
                {busy === "test" ? "Отправляем…" : "Отправить тест"}
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={busy !== null}
                onClick={() => void onUnlink()}
              >
                {busy === "unlink" ? "Отвязываем…" : "Отвязать"}
              </button>
            </div>
          </>
        ) : (
          <>
            <ol className="steps">
              <li>Сохраните токен бота выше и дождитесь статуса «работает».</li>
              <li>
                Добавьте {botLabel ?? "бота"} в группу сборщиков.
              </li>
              <li>
                В группе напишите <code>/bind</code> (может администратор группы). Эта страница
                подхватит чат сама.
              </li>
            </ol>
            <form onSubmit={(event) => void onLinkChat(event)}>
              <div className="field" style={{ maxWidth: 420 }}>
                <label htmlFor="tgChat">Или вставьте Chat ID вручную</label>
                <input
                  id="tgChat"
                  placeholder="-1001234567890"
                  value={groupChatId}
                  onChange={(event) => setGroupChatId(event.target.value)}
                />
              </div>
              <div className="btn-row">
                <button className="btn-secondary" disabled={busy !== null || groupChatId.trim().length < 1}>
                  {busy === "chat" ? "Привязываем…" : "Привязать по ID"}
                </button>
              </div>
            </form>
          </>
        )}
      </div>

      {error ? <div className="err">{error}</div> : null}
      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}
