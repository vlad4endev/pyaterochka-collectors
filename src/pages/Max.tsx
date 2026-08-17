import { useEffect, useState, type FormEvent } from "react";
import { PageHeader } from "../components/PageHeader";
import { api, type MaxBotUser, type MaxStatus } from "../lib/api";
import { errorMessage } from "../lib/format";
import { useApiQuery } from "../lib/useApi";
import { useSession } from "../session";

function formatSeen(ts: number): string {
  return new Date(ts).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function UserRow({
  user,
  onCopy,
}: {
  user: MaxBotUser;
  onCopy: (value: string, ok: string) => void;
}) {
  return (
    <tr>
      <td>
        <div>{user.name}</div>
        {user.username ? <div className="h2-sub" style={{ margin: 0 }}>@{user.username}</div> : null}
      </td>
      <td className="id-col">
        {user.phone ? (
          <button
            type="button"
            className="btn-quiet"
            onClick={() => onCopy(user.phone ?? "", "Телефон скопирован")}
          >
            {user.phone}
          </button>
        ) : (
          <span className="h2-sub" style={{ margin: 0 }}>
            не отправил
          </span>
        )}
      </td>
      <td className="id-col">
        <button
          type="button"
          className="btn-quiet"
          onClick={() => onCopy(user.maxUserId, "MAX ID скопирован")}
        >
          {user.maxUserId}
        </button>
      </td>
      <td>{user.collectorName ?? "—"}</td>
      <td>{formatSeen(user.lastSeenAt)}</td>
    </tr>
  );
}

export function MaxPage() {
  const { token } = useSession();
  const { data, error: loadError, reload } = useApiQuery(
    Boolean(token),
    () => api.max.get(token ?? ""),
    [token],
  );
  const { data: users, reload: reloadUsers } = useApiQuery(
    Boolean(token),
    () => api.max.users(token ?? ""),
    [token],
  );

  const [status, setStatus] = useState<MaxStatus | null>(null);
  const [botToken, setBotToken] = useState("");
  const [miniAppUrl, setMiniAppUrl] = useState("");
  const [urlReady, setUrlReady] = useState(false);
  const [groupChatId, setGroupChatId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState<
    "bot" | "clear" | "check" | "chat" | "unlink" | "test" | null
  >(null);

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
    if (!status?.botRunning) {
      return;
    }
    const timer = window.setInterval(() => {
      reload();
      reloadUsers();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [status?.botRunning, reload, reloadUsers]);

  const current = status ?? data;

  async function onSaveBot(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setToast(null);
    if (!current?.botTokenSet && botToken.trim().length < 1) {
      setError("Вставьте токен MAX-бота, чтобы подключить его");
      return;
    }
    setBusy("bot");
    try {
      const next = await api.max.saveBot(token ?? "", {
        botToken: botToken.trim() || undefined,
        miniAppUrl,
      });
      setStatus(next);
      setBotToken("");
      setMiniAppUrl(next.miniAppUrl ?? "");
      setToast(
        next.botRunning
          ? `Бот подключён${next.botName ? ` · ${next.botName}` : ""} ✓`
          : "Данные сохранены, бот ещё не запустился",
      );
      reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function onCheckBot() {
    setError(null);
    setToast(null);
    if (!current?.botTokenSet && botToken.trim().length < 1) {
      setError("Вставьте токен MAX-бота");
      return;
    }
    setBusy("check");
    try {
      const result = await api.max.checkBot(token ?? "", botToken.trim() || undefined);
      const label = result.username ? `${result.name} (@${result.username})` : result.name;
      setToast(`Связь с MAX есть · ${label}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function onClearToken() {
    if (!window.confirm("Удалить токен MAX-бота из базы? Бот остановится, если его нет в .env.")) {
      return;
    }
    setError(null);
    setToast(null);
    setBusy("clear");
    try {
      const next = await api.max.clearBot(token ?? "");
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
      const next = await api.max.linkChat(token ?? "", groupChatId.trim());
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
    if (!window.confirm("Отвязать группу MAX от админки?")) {
      return;
    }
    setError(null);
    setToast(null);
    setBusy("unlink");
    try {
      const next = await api.max.unlinkChat(token ?? "");
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
      await api.max.test(token ?? "");
      setToast("Тестовое сообщение отправлено в группу ✓");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function copyText(value: string, ok: string) {
    try {
      await navigator.clipboard.writeText(value);
      setToast(ok);
    } catch {
      setError("Не удалось скопировать");
    }
  }

  if (!current) {
    if (loadError) {
      return <div className="err">{errorMessage(loadError)}</div>;
    }
    return <div className="loading">Загрузка…</div>;
  }

  const botLabel = current.botUsername ? `@${current.botUsername}` : null;

  return (
    <div>
      <PageHeader
        title="MAX"
        sub="Сюда вставляется токен чат-бота — после сохранения админка сама подключается к MAX"
      />

      <form className="card" onSubmit={(event) => void onSaveBot(event)}>
        <h2>Подключение бота</h2>
        <div className="h2-sub">
          Токен берётся на{" "}
          <a href="https://business.max.ru" target="_blank" rel="noreferrer">
            платформе MAX для партнёров
          </a>
          : Чат-боты → Расширенные настройки → Настроить. Либо в{" "}
          <a href="https://max.ru/masterbot" target="_blank" rel="noreferrer">
            Master Bot
          </a>
          . Mini App — тот же https URL, что и для Telegram; его ещё нужно указать в настройках
          чат-бота MAX.
        </div>
        <div className="status-line">
          {current.botRunning ? (
            <span className="badge ok">
              {current.botName
                ? `подключён · ${current.botName}${botLabel ? ` ${botLabel}` : ""}`
                : botLabel
                  ? `работает ${botLabel}`
                  : "бот работает"}
            </span>
          ) : current.botTokenSet ? (
            <span className="badge warn">токен есть, бот не запущен</span>
          ) : (
            <span className="badge warn">не подключён — вставьте токен</span>
          )}
          {current.botTokenSource === "env" ? (
            <span className="badge info">сейчас из .env</span>
          ) : null}
        </div>
        <div className="field" style={{ maxWidth: 520 }}>
          <label htmlFor="maxToken">Токен бота</label>
          <input
            id="maxToken"
            type="password"
            autoComplete="off"
            placeholder={
              current.botTokenSet
                ? "Токен сохранён — введите новый, чтобы заменить"
                : "AAH…"
            }
            value={botToken}
            onChange={(event) => setBotToken(event.target.value)}
          />
        </div>
        <div className="field" style={{ maxWidth: 520 }}>
          <label htmlFor="maxMiniApp">URL мини-приложения (https)</label>
          <input
            id="maxMiniApp"
            type="url"
            placeholder="https://example.com"
            value={miniAppUrl}
            onChange={(event) => setMiniAppUrl(event.target.value)}
          />
        </div>
        <div className="btn-row">
          <button
            className="btn-primary"
            disabled={busy !== null || (!current.botTokenSet && botToken.trim().length < 1)}
          >
            {busy === "bot"
              ? "Подключаем…"
              : current.botTokenSet
                ? "Сохранить"
                : "Подключить бота"}
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={busy !== null || (!current.botTokenSet && botToken.trim().length < 1)}
            onClick={() => void onCheckBot()}
          >
            {busy === "check" ? "Проверяем…" : "Проверить связь"}
          </button>
          {current.botTokenSource === "database" ? (
            <button
              type="button"
              className="btn-secondary"
              disabled={busy !== null}
              onClick={() => void onClearToken()}
            >
              {busy === "clear" ? "Удаляем…" : "Отключить"}
            </button>
          ) : null}
        </div>
        {error ? <div className="err">{error}</div> : null}
        {toast ? <div className="toast">{toast}</div> : null}
      </form>

      <div className="note-card">
        Приложение открывается только из MAX-бота — кнопка «ВНЕСТИ». В браузере без бота Mini App
        не пускает. Каждый день в 10:00 по Москве бот пишет в личку тем, у кого в открытой неделе
        есть пропуск. Нужны MAX ID и хотя бы один запуск бота.
      </div>

      <div className="card">
        <h2>Кто запускал бота</h2>
        <div className="h2-sub">
          Имя и MAX ID появляются после /start. Телефон — если человек нажал «Отправить номер».
          Нажми на ID или номер, чтобы скопировать.
        </div>
        {users === undefined ? (
          <div className="loading">Загрузка…</div>
        ) : users.length === 0 ? (
          <div className="empty" style={{ textAlign: "left" }}>
            Пока никто не открывал бота.
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Имя</th>
                  <th className="id-col">Телефон</th>
                  <th className="id-col">MAX ID</th>
                  <th>Участник</th>
                  <th>Был</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <UserRow
                    key={user.maxUserId}
                    user={user}
                    onCopy={(value, ok) => void copyText(value, ok)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Групповой чат</h2>
        <div className="h2-sub">Сюда уйдёт сводка из админки. Бот должен быть добавлен в группу.</div>
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
              <li>Добавьте {botLabel ?? "бота"} в группу сборщиков.</li>
              <li>
                В группе напишите <code>/bind</code> (может администратор группы). Эта страница
                подхватит чат сама.
              </li>
            </ol>
            <form onSubmit={(event) => void onLinkChat(event)}>
              <div className="field" style={{ maxWidth: 420 }}>
                <label htmlFor="maxChat">Или вставьте Chat ID вручную</label>
                <input
                  id="maxChat"
                  placeholder="-1234567890"
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
    </div>
  );
}
