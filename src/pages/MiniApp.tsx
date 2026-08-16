import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, type MiniHome, type MiniPerson } from "../lib/api";
import {
  DAY_NAMES,
  DAY_SHORT,
  errorMessage,
  formatKg,
  formatRub,
  fmtShort,
  periodLabel,
  weekdayFromIso,
} from "../lib/format";
import { bootTelegramWebApp } from "../lib/telegram";

function statusLabel(status: "pending" | "confirmed" | "rejected"): string {
  if (status === "confirmed") {
    return "ок";
  }
  if (status === "pending") {
    return "проверка";
  }
  return "нет";
}

function haptic(kind: "success" | "error" | "warning") {
  window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred(kind);
}

function defaultForId(home: MiniHome, date: string): string {
  if (!home.collector) {
    return "";
  }
  const day = home.days.find((item) => item.date === date);
  if (!day) {
    return "";
  }
  const mine = home.collector.dayOfWeek !== null && day.weekday === home.collector.dayOfWeek;
  if (mine) {
    return "";
  }
  return day.scheduled.find((person) => person._id !== home.collector?._id)?._id ?? "";
}

function firstName(name: string): string {
  return name.split(" ")[0] ?? name;
}

export function MiniAppPage() {
  const [initData, setInitData] = useState<string | null>(null);
  const [home, setHome] = useState<MiniHome | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [kg, setKg] = useState("");
  const [date, setDate] = useState("");
  const [forId, setForId] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  const photoInput = useRef<HTMLInputElement>(null);

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
        setDate((current) => {
          const next =
            current && value.days.some((day) => day.date === current)
              ? current
              : value.days.some((day) => day.date === value.today.date)
                ? value.today.date
                : (value.days[0]?.date ?? value.today.date);
          setForId((prev) => (current ? prev : defaultForId(value, next)));
          return next;
        });
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

  useEffect(() => {
    if (!photo) {
      setPhotoUrl(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPhotoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const selectedDay = home?.days.find((day) => day.date === date);
  const myDay =
    Boolean(home?.collector) &&
    home?.collector?.dayOfWeek !== null &&
    selectedDay?.weekday === home?.collector?.dayOfWeek;
  const showWho = Boolean(
    home?.collector?.active &&
      home.period?.status === "open" &&
      selectedDay &&
      !myDay &&
      home.others.length > 0,
  );
  const forPerson = home?.others.find((person) => person._id === forId);
  const canSubmit = Number(kg) > 0 || photo !== null;
  const kgPreview = Number(kg);
  const amountPreview =
    home?.period && Number.isFinite(kgPreview) && kgPreview > 0
      ? kgPreview * home.period.rate
      : null;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!initData || !home?.collector) {
      return;
    }
    if (!canSubmit) {
      return;
    }
    setBusy(true);
    setError(null);
    setToast(null);
    try {
      await api.miniapp.createEntry(initData, {
        date,
        kg: Number(kg) > 0 ? Number(kg) : undefined,
        collectorId: showWho && forId ? forId : undefined,
        photo: photo ?? undefined,
      });
      setKg("");
      setPhoto(null);
      haptic("success");
      setToast(
        showWho && forPerson
          ? `Записано на ${firstName(forPerson.name)} — на проверке`
          : "Отправлено на проверку",
      );
      setEpoch((value) => value + 1);
    } catch (err) {
      haptic("error");
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function pickDate(next: string) {
    setDate(next);
    if (home) {
      setForId(defaultForId(home, next));
    }
  }

  async function copyPayTo() {
    if (!home?.settings?.payTo) {
      return;
    }
    try {
      await navigator.clipboard.writeText(home.settings.payTo);
      setToast("Номер карты скопирован");
      haptic("success");
    } catch {
      setError("Не удалось скопировать");
    }
  }

  if (initData === null) {
    return <div className="loading ma-screen">Открываем…</div>;
  }

  if (!initData) {
    return (
      <div className="miniapp">
        <div className="card">
          <h2>Открой через Telegram</h2>
          <div className="h2-sub" style={{ marginBottom: 0 }}>
            Нажми «Открыть приложение» в боте — так подтянутся твои килограммы и сумма.
          </div>
        </div>
      </div>
    );
  }

  if (home === undefined && !error) {
    return <div className="loading ma-screen">Загрузка…</div>;
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

  const periodOpen = home.period?.status === "open";
  const whoOptions: MiniPerson[] = home.others;

  return (
    <div className="miniapp">
      <div className="ma-top">
        <div>
          <h1 className="page-title">{home.collector?.name ?? home.telegram.firstName}</h1>
          <div className="page-sub">
            {home.period
              ? periodLabel(home.period.startDate, home.period.endDate)
              : "Пятёрка на бульваре"}
          </div>
        </div>
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

      {home.me ? (
        <div className="ma-hero">
          <div className="ma-hero-label">К переводу за период</div>
          <div className="ma-amount">{formatRub(home.me.amountRub)} ₽</div>
          <div className="ma-hero-meta">
            {formatKg(home.me.kg)} кг
            {home.period ? ` × ${formatRub(home.period.rate)} ₽` : ""}
          </div>
          <div className="ma-hero-row">
            {home.me.paidAt ? (
              <span className="badge ok">перевёл</span>
            ) : home.me.kg > 0 ? (
              <span className="badge warn">ещё не перевёл</span>
            ) : (
              <span className="badge info">пока 0 кг</span>
            )}
            {home.collector?.dayOfWeek !== null && home.collector?.dayOfWeek !== undefined ? (
              <span className="ma-slot">твой день — {DAY_NAMES[home.collector.dayOfWeek]}</span>
            ) : null}
          </div>
          {home.settings ? (
            <button type="button" className="ma-pay" onClick={() => void copyPayTo()}>
              <span>
                {home.settings.bank} · {home.settings.payTo}
              </span>
              <span className="ma-pay-hint">{home.settings.deadlineText} · нажми, чтобы скопировать</span>
            </button>
          ) : null}
        </div>
      ) : home.period ? (
        <div className="card">
          <h2>Период открыт</h2>
          <div className="h2-sub" style={{ marginBottom: 0 }}>
            {periodLabel(home.period.startDate, home.period.endDate)}
          </div>
        </div>
      ) : (
        <div className="card">
          <h2>Период ещё не открыт</h2>
          <div className="h2-sub" style={{ marginBottom: 0 }}>
            Обычно неделя появляется сама с понедельника.
          </div>
        </div>
      )}

      {home.collector?.active && home.period && periodOpen ? (
        <form className="card ma-form" onSubmit={(event) => void onSubmit(event)}>
          <h2>Внести</h2>
          <div className="h2-sub">
            Фото ведомости и кг. Если взял чужой день — сначала день и за кого.
          </div>

          <div className="field">
            <label>День</label>
            <div className="ma-chips">
              {home.days.map((day) => {
                const mine =
                  home.collector?.dayOfWeek !== null && day.weekday === home.collector?.dayOfWeek;
                const other = day.scheduled.find((person) => person._id !== home.collector?._id);
                return (
                  <button
                    type="button"
                    key={day.date}
                    className={`ma-chip${date === day.date ? " active" : ""}${day.date === home.today.date ? " today" : ""}`}
                    onClick={() => pickDate(day.date)}
                  >
                    <span className="ma-chip-d">{DAY_SHORT[day.weekday]}</span>
                    <span className="ma-chip-n">{fmtShort(day.date)}</span>
                    <span className="ma-chip-who">{mine ? "ты" : other ? firstName(other.name) : " "}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {showWho ? (
            <div className="field">
              <label>За кого взял</label>
              <div className="ma-chips ma-chips-wrap">
                <button
                  type="button"
                  className={`ma-chip${forId === "" ? " active" : ""}`}
                  onClick={() => setForId("")}
                >
                  Себе
                </button>
                {whoOptions.map((person) => {
                  const scheduled = selectedDay?.scheduled.some((row) => row._id === person._id);
                  return (
                    <button
                      type="button"
                      key={person._id}
                      className={`ma-chip${forId === person._id ? " active" : ""}`}
                      onClick={() => setForId(person._id)}
                    >
                      {firstName(person.name)}
                      {scheduled ? <span className="ma-chip-mark">день</span> : null}
                    </button>
                  );
                })}
              </div>
              <div className="h2-sub" style={{ marginTop: 8, marginBottom: 0 }}>
                {forPerson
                  ? `Кг пойдут ${firstName(forPerson.name)}, ты будешь в «от».`
                  : "Запишу на тебя."}
              </div>
            </div>
          ) : null}

          <div className="field">
            <label htmlFor="maPhoto">Ведомость</label>
            <input
              id="maPhoto"
              ref={photoInput}
              type="file"
              accept="image/*"
              capture="environment"
              className="ma-file"
              onChange={(event) => setPhoto(event.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              className={`ma-photo${photoUrl ? " has" : ""}`}
              onClick={() => photoInput.current?.click()}
            >
              {photoUrl ? (
                <img src={photoUrl} alt="Ведомость" />
              ) : (
                <span>Сфотографировать или выбрать фото</span>
              )}
            </button>
            {photo ? (
              <button type="button" className="ma-link" onClick={() => setPhoto(null)}>
                Убрать фото
              </button>
            ) : null}
          </div>

          <div className="field">
            <label htmlFor="maKg">Килограммы</label>
            <div className="ma-kg-wrap">
              <input
                id="maKg"
                className="ma-kg"
                type="number"
                min="0"
                step="0.1"
                inputMode="decimal"
                placeholder="0"
                value={kg}
                onChange={(event) => setKg(event.target.value)}
              />
              <span>кг</span>
            </div>
            {amountPreview !== null ? (
              <div className="h2-sub" style={{ marginTop: 8, marginBottom: 0 }}>
                ≈ {formatRub(amountPreview)} ₽ к сумме
              </div>
            ) : (
              <div className="h2-sub" style={{ marginTop: 8, marginBottom: 0 }}>
                Можно только фото — кг потом проставит организатор.
              </div>
            )}
          </div>

          <button className="btn-primary" disabled={busy || !canSubmit}>
            {busy ? "Отправляем…" : "Отправить на проверку"}
          </button>
        </form>
      ) : null}

      {home.me && home.me.gaps.length > 0 ? (
        <div className="card">
          <h2>
            Пропуски <span className="badge info">{home.me.gaps.length}</span>
          </h2>
          <div className="h2-sub">Нажми день, чтобы сразу внести</div>
          {home.me.gaps.map((gap) => (
            <button type="button" className="ma-gap" key={gap.date} onClick={() => pickDate(gap.date)}>
              <span>
                {fmtShort(gap.date)} · {DAY_SHORT[weekdayFromIso(gap.date)]}
              </span>
              <span className="d">внести</span>
            </button>
          ))}
        </div>
      ) : null}

      {home.me ? (
        <div className="card">
          <h2>Записи</h2>
          {home.me.entries.length === 0 ? (
            <div className="empty">Пока пусто</div>
          ) : (
            home.me.entries.map((entry) => (
              <div className="gap-item" key={entry._id}>
                <span>
                  {fmtShort(entry.date)}
                  {entry.kg !== undefined ? ` · ${formatKg(entry.kg)} кг` : entry.hasPhoto ? " · фото" : ""}
                  {entry.creditedForName ? ` · за ${firstName(entry.creditedForName)}` : ""}
                  {entry.creditedByName ? ` · от ${firstName(entry.creditedByName)}` : ""}
                </span>
                <span className={`ma-st ${entry.status}`}>{statusLabel(entry.status)}</span>
              </div>
            ))
          )}
        </div>
      ) : null}

      {error ? <div className="err">{error}</div> : null}
      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}
