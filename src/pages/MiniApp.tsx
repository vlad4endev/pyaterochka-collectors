import { useEffect, useState, type FormEvent } from "react";
import { api, type MiniHome } from "../lib/api";
import {
  DAY_NAMES,
  dayName,
  errorMessage,
  formatKg,
  formatRub,
  fmtShort,
  periodLabel,
} from "../lib/format";
import { bootTelegramWebApp } from "../lib/telegram";

function statusLabel(status: "pending" | "confirmed" | "rejected"): string {
  if (status === "confirmed") {
    return "подтверждено";
  }
  if (status === "pending") {
    return "на проверке";
  }
  return "отклонено";
}

function windowCopy(home: MiniHome): { title: string; sub: string } {
  const start = home.settings?.windowStart ?? 17;
  const end = home.settings?.windowEnd ?? 21;
  if (!home.today.isMyDay) {
    const day =
      home.collector?.dayOfWeek !== null && home.collector?.dayOfWeek !== undefined
        ? DAY_NAMES[home.collector.dayOfWeek]
        : null;
    return {
      title: "Сегодня не твой день",
      sub: day
        ? `Твой слот — ${day}, окно ${start}:00–${end}:00`
        : "День в графике пока не назначен",
    };
  }
  if (home.today.windowStatus === "before") {
    return { title: `Окно с ${start}:00`, sub: "Можно заранее открыть приложение и сдать кг" };
  }
  if (home.today.windowStatus === "after") {
    return { title: "Окно уже закрылось", sub: `Приём был до ${end}:00. Фото всё равно можно прислать боту.` };
  }
  return { title: "Окно открыто", sub: `Сдай накладную до ${end}:00 — фото боту или кг ниже` };
}

export function MiniAppPage() {
  const [initData, setInitData] = useState<string | null>(null);
  const [home, setHome] = useState<MiniHome | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [kg, setKg] = useState("");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [creditKg, setCreditKg] = useState("");
  const [creditDate, setCreditDate] = useState("");
  const [creditFor, setCreditFor] = useState("");
  const [creditNote, setCreditNote] = useState("");
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    const webApp = bootTelegramWebApp();
    setInitData(webApp?.initData ?? "");
  }, []);

  useEffect(() => {
    if (!initData) {
      return;
    }
    let cancelled = false;
    setError(null);
    api.miniapp
      .home(initData)
      .then((value) => {
        if (cancelled) {
          return;
        }
        setHome(value);
        setDate((current) => current || value.today.date);
        setCreditDate((current) => current || value.today.date);
        setCreditFor((current) => current || value.others[0]?._id || "");
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(errorMessage(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [initData, epoch]);

  async function onManual(event: FormEvent) {
    event.preventDefault();
    if (!initData) {
      return;
    }
    setBusy(true);
    setError(null);
    setToast(null);
    try {
      await api.miniapp.createManual(initData, {
        date,
        kg: Number(kg),
        note: note.trim() || undefined,
      });
      setKg("");
      setNote("");
      setToast("Отправлено на проверку");
      setEpoch((value) => value + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function onCredit(event: FormEvent) {
    event.preventDefault();
    if (!initData || !creditFor) {
      return;
    }
    setBusy(true);
    setError(null);
    setToast(null);
    try {
      await api.miniapp.createCredit(initData, {
        collectorId: creditFor,
        date: creditDate,
        kg: Number(creditKg),
        note: creditNote.trim() || undefined,
      });
      setCreditKg("");
      setCreditNote("");
      setToast("Зачёт отправлен на проверку");
      setEpoch((value) => value + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (initData === null) {
    return <div className="loading" style={{ padding: 32 }}>Открываем приложение…</div>;
  }

  if (!initData) {
    return (
      <div className="miniapp">
        <div className="card">
          <h2>Открой через Telegram</h2>
          <div className="h2-sub" style={{ marginBottom: 0 }}>
            Нажми «Открыть приложение» в боте — так сразу подтянутся твои данные.
          </div>
        </div>
      </div>
    );
  }

  if (home === undefined && !error) {
    return <div className="loading" style={{ padding: 32 }}>Загрузка…</div>;
  }

  if (!home) {
    return (
      <div className="miniapp">
        <div className="card">
          <h2>Не удалось открыть</h2>
          <div className="err">{error}</div>
        </div>
      </div>
    );
  }

  const windowText = windowCopy(home);
  const periodOpen = home.period?.status === "open";

  return (
    <div className="miniapp">
      <h1 className="page-title">{home.collector?.name ?? `Привет, ${home.telegram.firstName}`}</h1>
      <div className="page-sub">
        {home.period
          ? periodLabel(home.period.startDate, home.period.endDate)
          : "Пятёрка на бульваре"}
      </div>

      {!home.collector ? (
        <div className="card">
          <h2>Тебя ещё нет в списке</h2>
          <div className="h2-sub" style={{ marginBottom: 0 }}>
            Покажи организатору свой Telegram ID: <strong>{home.telegram.id}</strong>
          </div>
        </div>
      ) : null}

      {home.collector && !home.collector.active ? (
        <div className="card">
          <h2>Ты скрыт в списке</h2>
          <div className="h2-sub" style={{ marginBottom: 0 }}>
            Напиши организатору, чтобы снова появиться в графике.
          </div>
        </div>
      ) : null}

      {!home.period ? (
        <div className="card">
          <h2>Период ещё не открыт</h2>
          <div className="h2-sub" style={{ marginBottom: 0 }}>
            Когда организатор откроет двухнедельку, здесь появятся кг и сумма.
          </div>
        </div>
      ) : null}

      {home.collector?.active ? (
        <div className="card">
          <h2>{windowText.title}</h2>
          <div className="h2-sub" style={{ marginBottom: 0 }}>
            {windowText.sub}
          </div>
        </div>
      ) : null}

      {home.me ? (
        <div className="card">
          <h2>За этот период</h2>
          <div className="stat-row">
            <span>Собрано</span>
            <span className="val">
              {formatKg(home.me.kg)} кг · {formatRub(home.me.amountRub)} ₽
            </span>
          </div>
          <div className="stat-row">
            <span>Перевод</span>
            <span className="val">
              {home.me.paidAt ? (
                <span className="badge ok">перевёл</span>
              ) : home.me.kg > 0 ? (
                <span className="badge warn">ещё нет</span>
              ) : (
                "—"
              )}
            </span>
          </div>
          {home.settings ? (
            <div className="h2-sub" style={{ marginTop: 10, marginBottom: 0 }}>
              {home.settings.bank} · {home.settings.payTo} · {home.settings.deadlineText}
            </div>
          ) : null}
        </div>
      ) : null}

      {home.me && home.me.gaps.length > 0 ? (
        <div className="card">
          <h2>
            Пропуски <span className="badge info">{home.me.gaps.length}</span>
          </h2>
          {home.me.gaps.map((gap) => (
            <div className="gap-item" key={gap.date}>
              <span>{fmtShort(gap.date)}</span>
              <span className="d">{dayName(gap.date)}</span>
            </div>
          ))}
        </div>
      ) : null}

      {home.me ? (
        <div className="card">
          <h2>Мои записи</h2>
          {home.me.entries.length === 0 ? (
            <div className="empty">Пока пусто</div>
          ) : (
            home.me.entries.map((entry) => (
              <div className="gap-item" key={entry._id}>
                <span>
                  {fmtShort(entry.date)}
                  {entry.kg !== undefined ? ` · ${formatKg(entry.kg)} кг` : ""}
                  {entry.creditedByName ? ` · от ${entry.creditedByName}` : ""}
                </span>
                <span className="d">{statusLabel(entry.status)}</span>
              </div>
            ))
          )}
        </div>
      ) : null}

      {home.collector?.active && home.period && periodOpen ? (
        <>
          <form className="card" onSubmit={(event) => void onManual(event)}>
            <h2>Сдать кг</h2>
            <div className="h2-sub">Уйдёт на проверку. Фото накладной удобнее прислать боту в чат.</div>
            <div className="grid2" style={{ maxWidth: "none" }}>
              <div className="field">
                <label htmlFor="mDate">Дата</label>
                <input
                  id="mDate"
                  type="date"
                  min={home.period.startDate}
                  max={home.period.endDate}
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="mKg">Кг</label>
                <input
                  id="mKg"
                  type="number"
                  min="0"
                  step="0.1"
                  value={kg}
                  onChange={(event) => setKg(event.target.value)}
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="mNote">Заметка</label>
              <input
                id="mNote"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="необязательно"
              />
            </div>
            <button className="btn-primary" disabled={busy || Number(kg) <= 0}>
              Отправить
            </button>
          </form>

          {home.others.length > 0 ? (
            <form className="card" onSubmit={(event) => void onCredit(event)}>
              <h2>Засчитать за другого</h2>
              <div className="h2-sub">Если забрал слот за участника — кг запишутся ему, ты будешь в «от».</div>
              <div className="field">
                <label htmlFor="cFor">Кому</label>
                <select
                  id="cFor"
                  value={creditFor}
                  onChange={(event) => setCreditFor(event.target.value)}
                >
                  {home.others.map((person) => (
                    <option key={person._id} value={person._id}>
                      {person.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid2" style={{ maxWidth: "none" }}>
                <div className="field">
                  <label htmlFor="cDate">Дата</label>
                  <input
                    id="cDate"
                    type="date"
                    min={home.period.startDate}
                    max={home.period.endDate}
                    value={creditDate}
                    onChange={(event) => setCreditDate(event.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="cKg">Кг</label>
                  <input
                    id="cKg"
                    type="number"
                    min="0"
                    step="0.1"
                    value={creditKg}
                    onChange={(event) => setCreditKg(event.target.value)}
                  />
                </div>
              </div>
              <div className="field">
                <label htmlFor="cNote">Заметка</label>
                <input
                  id="cNote"
                  value={creditNote}
                  onChange={(event) => setCreditNote(event.target.value)}
                  placeholder="необязательно"
                />
              </div>
              <button className="btn-primary" disabled={busy || !creditFor || Number(creditKg) <= 0}>
                Засчитать
              </button>
            </form>
          ) : null}
        </>
      ) : null}

      {error ? <div className="err">{error}</div> : null}
      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}
