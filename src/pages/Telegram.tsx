import { useEffect, useState, type FormEvent } from "react";
import { PageHeader } from "../components/PageHeader";
import { api, type TelegramPathCheck, type TelegramStatus } from "../lib/api";
import { errorMessage } from "../lib/format";
import { useApiQuery } from "../lib/useApi";
import { useSession } from "../session";

const PATH_ERRORS: Record<NonNullable<TelegramPathCheck["error"]>, string> = {
  timeout: "нет ответа — истекло время ожидания",
  refused: "прокси отклонил соединение, проверьте хост и порт",
  host_not_found: "хост прокси не найден",
  auth: "прокси не принял логин или пароль",
  reset: "соединение сброшено",
  unreachable: "нет доступа к api.telegram.org",
};

function formatLatency(ms: number): string {
  return ms < 1000 ? `${ms} мс` : `${(ms / 1000).toFixed(1)} с`;
}

function formatAgo(checkedAt: number, now: number): string {
  const sec = Math.max(0, Math.round((now - checkedAt) / 1000));
  if (sec < 8) {
    return "только что";
  }
  if (sec < 60) {
    return `${sec} с назад`;
  }
  const min = Math.round(sec / 60);
  if (min < 60) {
    return `${min} мин назад`;
  }
  return "больше часа назад";
}

function proxyEndpoint(status: TelegramStatus): string | null {
  if (!status.proxyConfigured || !status.proxyType || !status.proxyHost || status.proxyPort == null) {
    return null;
  }
  const kind = status.proxyType === "socks5" ? "SOCKS5" : "HTTP";
  return `${kind} ${status.proxyHost}:${status.proxyPort}`;
}

function pathHealth(
  status: TelegramStatus,
  checking: boolean,
  now: number,
): { tone: "ok" | "warn" | "bad" | "check"; title: string; meta: string } {
  const check = status.pathCheck;
  const endpoint = proxyEndpoint(status);
  const ago = check ? formatAgo(check.checkedAt, now) : null;
  const latency = check ? formatLatency(check.latencyMs) : null;
  const reason = check?.error ? PATH_ERRORS[check.error] : null;

  if (checking && !check) {
    return {
      tone: "check",
      title: endpoint ? "Проверяем прокси…" : "Проверяем Telegram API…",
      meta: endpoint ? `Через ${endpoint}` : "Прямое соединение, без прокси",
    };
  }

  if (!check) {
    return {
      tone: "warn",
      title: "Доступ ещё не проверяли",
      meta: endpoint
        ? `Задан ${endpoint}, но до Telegram ещё не достучались`
        : "Прокси выключен — нажмите «Проверить», чтобы узнать, виден ли Telegram",
    };
  }

  if (status.proxyConfigured && endpoint) {
    if (check.ok && check.via === "proxy") {
      return {
        tone: "ok",
        title: "Прокси работает",
        meta: `${endpoint} · Telegram ответил за ${latency} · ${ago}${checking ? " · обновляем…" : ""}`,
      };
    }
    return {
      tone: "bad",
      title: "Прокси не работает",
      meta: `${endpoint} · ${reason ?? "Telegram не ответил"} · ${ago}${checking ? " · обновляем…" : ""}`,
    };
  }

  if (check.ok && check.via === "direct") {
    return {
      tone: "ok",
      title: "Прокси не нужен",
      meta: `Telegram доступен напрямую, ответ за ${latency} · ${ago}${checking ? " · обновляем…" : ""}`,
    };
  }

  return {
    tone: "warn",
    title: "Без прокси Telegram недоступен",
    meta: `${reason ?? "api.telegram.org не отвечает"} · ${ago}${checking ? " · обновляем…" : ""}`,
  };
}

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
  const [proxyType, setProxyType] = useState<"none" | "http" | "socks5">("none");
  const [proxyHost, setProxyHost] = useState("");
  const [proxyPort, setProxyPort] = useState("");
  const [proxyUsername, setProxyUsername] = useState("");
  const [proxyPassword, setProxyPassword] = useState("");
  const [proxyReady, setProxyReady] = useState(false);
  const [groupChatId, setGroupChatId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState<
    "bot" | "clear" | "proxy" | "check" | "chat" | "unlink" | "test" | null
  >(null);
  const [checking, setChecking] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!data) {
      return;
    }
    setStatus((prev) => {
      if (
        prev?.pathCheck &&
        (!data.pathCheck || prev.pathCheck.checkedAt > data.pathCheck.checkedAt)
      ) {
        return { ...data, pathCheck: prev.pathCheck };
      }
      return data;
    });
    if (!urlReady) {
      setMiniAppUrl(data.miniAppUrl ?? "");
      setUrlReady(true);
    }
    if (!proxyReady) {
      setProxyType(data.proxyType ?? "none");
      setProxyHost(data.proxyHost ?? "");
      setProxyPort(data.proxyPort != null ? String(data.proxyPort) : "");
      setProxyUsername(data.proxyUsername ?? "");
      setProxyReady(true);
    }
  }, [data, urlReady, proxyReady]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!token) {
      return;
    }
    let cancelled = false;
    setChecking(true);
    void api.telegram
      .checkPath(token)
      .then((next) => {
        if (!cancelled) {
          setStatus(next);
        }
      })
      .catch(() => {
        /* оставляем прошлый результат, если он есть */
      })
      .finally(() => {
        if (!cancelled) {
          setChecking(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

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

  function applyProxyStatus(next: TelegramStatus) {
    setStatus(next);
    setProxyType(next.proxyType ?? "none");
    setProxyHost(next.proxyHost ?? "");
    setProxyPort(next.proxyPort != null ? String(next.proxyPort) : "");
    setProxyUsername(next.proxyUsername ?? "");
    setProxyPassword("");
  }

  async function onSaveProxy(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setToast(null);
    setBusy("proxy");
    try {
      const next = await api.telegram.saveProxy(token ?? "", {
        type: proxyType,
        host: proxyHost,
        port: proxyPort === "" ? "" : Number(proxyPort),
        username: proxyUsername,
        password: proxyPassword,
      });
      applyProxyStatus(next);
      if (proxyType === "none" && next.proxySource === "env") {
        setToast("В базе очищено, но прокси всё ещё берётся из .env");
      } else if (next.pathCheck?.ok && next.proxyConfigured) {
        setToast("Прокси работает — Telegram отвечает");
      } else if (next.proxyConfigured && next.pathCheck && !next.pathCheck.ok) {
        setToast("Прокси сохранён, но Telegram через него не отвечает");
      } else {
        setToast(next.proxyConfigured ? "Прокси сохранён ✓" : "Прокси отключён");
      }
      reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function onCheckPath() {
    setError(null);
    setToast(null);
    setBusy("check");
    setChecking(true);
    try {
      const next = await api.telegram.checkPath(token ?? "");
      setStatus(next);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setChecking(false);
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
  const health = pathHealth(current, checking, now);

  return (
    <div>
      <PageHeader
        title="Telegram"
        sub="Бот, прокси, мини-приложение и групповой чат — без правки .env"
      />

      <form className="card" onSubmit={(event) => void onSaveProxy(event)}>
        <h2>Прокси</h2>
        <div className="h2-sub">
          Если Telegram API недоступен напрямую, укажите HTTP или SOCKS5. MTProto-прокси из
          Telegram-клиента сюда не подойдёт.
        </div>
        <div className={`health health-${health.tone}`}>
          <span className="health-dot" aria-hidden="true" />
          <div className="health-body">
            <div className="health-title">{health.title}</div>
            <div className="health-meta">{health.meta}</div>
            {current.proxySource === "env" ? (
              <div className="health-tags">
                <span className="badge info">сейчас из .env</span>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="btn-secondary health-btn"
            disabled={busy !== null || checking}
            onClick={() => void onCheckPath()}
          >
            {checking || busy === "check" ? "Проверяем…" : "Проверить"}
          </button>
        </div>
        <div className="field" style={{ maxWidth: 520 }}>
          <label htmlFor="tgProxyType">Тип</label>
          <select
            id="tgProxyType"
            value={proxyType}
            onChange={(event) =>
              setProxyType(event.target.value as "none" | "http" | "socks5")
            }
          >
            <option value="none">Без прокси</option>
            <option value="http">HTTP</option>
            <option value="socks5">SOCKS5</option>
          </select>
        </div>
        {proxyType !== "none" ? (
          <>
            <div className="grid2" style={{ maxWidth: 520 }}>
              <div className="field">
                <label htmlFor="tgProxyHost">Хост</label>
                <input
                  id="tgProxyHost"
                  autoComplete="off"
                  placeholder="127.0.0.1"
                  value={proxyHost}
                  onChange={(event) => setProxyHost(event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="tgProxyPort">Порт</label>
                <input
                  id="tgProxyPort"
                  inputMode="numeric"
                  placeholder="1080"
                  value={proxyPort}
                  onChange={(event) => setProxyPort(event.target.value)}
                />
              </div>
            </div>
            <div className="grid2" style={{ maxWidth: 520 }}>
              <div className="field">
                <label htmlFor="tgProxyUser">Логин (если есть)</label>
                <input
                  id="tgProxyUser"
                  autoComplete="off"
                  value={proxyUsername}
                  onChange={(event) => setProxyUsername(event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="tgProxyPass">Пароль</label>
                <input
                  id="tgProxyPass"
                  type="password"
                  autoComplete="new-password"
                  placeholder={
                    current.proxyPasswordSet
                      ? "Пароль сохранён — введите новый, чтобы заменить"
                      : ""
                  }
                  value={proxyPassword}
                  onChange={(event) => setProxyPassword(event.target.value)}
                />
              </div>
            </div>
          </>
        ) : null}
        <div className="btn-row">
          <button className="btn-primary" disabled={busy !== null}>
            {busy === "proxy" ? "Сохраняем…" : "Сохранить прокси"}
          </button>
        </div>
      </form>

      <form className="card" onSubmit={(event) => void onSaveBot(event)}>
        <h2>Бот</h2>
        <div className="h2-sub">
          Токен берётся у <code>@BotFather</code>. Если API заблокирован, сначала сохраните прокси
          выше. После сохранения бот запускается сам.
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
