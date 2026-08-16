import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, type MiniHome, type MiniPerson } from "../lib/api";
import {
  DAY_NAMES,
  DAY_SHORT,
  errorMessage,
  formatKg,
  formatMoney,
  fmtHuman,
  initials,
  weekdayFromIso,
} from "../lib/format";
import { bootTelegramWebApp } from "../lib/telegram";

function haptic(kind: "success" | "error" | "warning" | "select") {
  const feedback = window.Telegram?.WebApp?.HapticFeedback;
  if (kind === "select") {
    feedback?.selectionChanged();
    return;
  }
  feedback?.notificationOccurred(kind);
}

function scheduledOthers(home: MiniHome, date: string): MiniPerson[] {
  const day = home.days.find((item) => item.date === date);
  if (!day) {
    return [];
  }
  return day.scheduled.filter((person) => person._id !== home.collector?._id);
}

function defaultForId(home: MiniHome, date: string): string {
  if (!home.collector || isMyScheduledDay(home, date)) {
    return "";
  }
  return scheduledOthers(home, date)[0]?._id ?? "";
}

function firstName(name: string): string {
  return name.split(" ")[0] ?? name;
}

function isMyScheduledDay(home: MiniHome, date: string): boolean {
  const day = home.days.find((item) => item.date === date);
  return Boolean(
    home.collector &&
      home.collector.dayOfWeek !== null &&
      day &&
      day.weekday === home.collector.dayOfWeek,
  );
}

function openDays(home: MiniHome) {
  return home.days.filter((day) => day.date <= home.today.date);
}

function defaultOpenDate(home: MiniHome, current?: string): string {
  const days = openDays(home);
  if (current && days.some((day) => day.date === current)) {
    return current;
  }
  return days.find((day) => day.date === home.today.date)?.date ?? days[0]?.date ?? home.today.date;
}

function statusCopy(status: "pending" | "confirmed" | "rejected" | "skipped"): string {
  if (status === "confirmed") {
    return "принято";
  }
  if (status === "pending") {
    return "проверка";
  }
  if (status === "skipped") {
    return "не брал";
  }
  return "отклонено";
}

function IconCam() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M4 8h3l2-2.4h6L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
      <circle cx="12" cy="13.2" r="3.2" />
    </svg>
  );
}

function IconCopy() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="8" y="8" width="11" height="12" rx="2" />
      <path d="M5 16V6a2 2 0 0 1 2-2h8" />
    </svg>
  );
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
  const [dayOpen, setDayOpen] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const kgInput = useRef<HTMLInputElement>(null);

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
          const next = defaultOpenDate(value, current);
          setForId((prev) => (current && next === current ? prev : defaultForId(value, next)));
          if (!current && !isMyScheduledDay(value, next)) {
            setDayOpen(true);
          }
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

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const selectedDay = home?.days.find((day) => day.date === date);
  const myDay = Boolean(home && date && isMyScheduledDay(home, date));
  const whoOptions = home && date ? scheduledOthers(home, date) : [];
  const showWho = Boolean(
    home?.collector?.active &&
      home.period?.status === "open" &&
      selectedDay &&
      !myDay &&
      whoOptions.length > 0,
  );
  const forPerson = whoOptions.find((person) => person._id === forId) ?? whoOptions[0];
  const canSubmit = Number(kg) > 0 || photo !== null;
  const kgPreview = Number(kg);
  const amountPreview =
    home?.period && Number.isFinite(kgPreview) && kgPreview > 0
      ? kgPreview * home.period.rate
      : null;
  const todaySelected = Boolean(home && date === home.today.date);

  function pickDate(next: string, opts?: { scroll?: boolean }) {
    if (home && next > home.today.date) {
      return;
    }
    haptic("select");
    setDate(next);
    if (home) {
      setForId(defaultForId(home, next));
      if (!isMyScheduledDay(home, next)) {
        setDayOpen(true);
      }
    }
    if (opts?.scroll) {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      window.setTimeout(() => kgInput.current?.focus(), 280);
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!initData || !home?.collector || !canSubmit) {
      return;
    }
    if (date > home.today.date) {
      setError("Нельзя внести за день, который ещё не наступил");
      return;
    }
    setBusy(true);
    setError(null);
    setToast(null);
    try {
      await api.miniapp.createEntry(initData, {
        date,
        kg: Number(kg) > 0 ? Number(kg) : undefined,
        collectorId: showWho ? forId || forPerson?._id : undefined,
        photo: photo ?? undefined,
      });
      setKg("");
      setPhoto(null);
      setDayOpen(false);
      haptic("success");
      setToast(
        showWho && forPerson
          ? `За ${firstName(forPerson.name)} · кг тебе · на проверке`
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

  async function onSkipDay() {
    if (!initData || !home?.collector) {
      return;
    }
    setBusy(true);
    setError(null);
    setToast(null);
    try {
      await api.miniapp.skip(initData, date);
      setKg("");
      setPhoto(null);
      setDayOpen(false);
      haptic("success");
      setToast("Отметили: не брал");
      setEpoch((value) => value + 1);
    } catch (err) {
      haptic("error");
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function copyText(value: string, ok: string) {
    try {
      await navigator.clipboard.writeText(value);
      haptic("success");
      setToast(ok);
    } catch {
      setError("Не удалось скопировать");
    }
  }

  function submitLabel(): string {
    if (busy) {
      return "Отправляем";
    }
    if (showWho && forPerson) {
      return Number(kg) > 0
        ? `Отправить ${formatKg(Number(kg))} кг за ${firstName(forPerson.name)}`
        : `Отправить фото за ${firstName(forPerson.name)}`;
    }
    if (Number(kg) > 0) {
      return `Отправить ${formatKg(Number(kg))} кг`;
    }
    return "Отправить фото";
  }

  if (initData === null || (home === undefined && !error && initData)) {
    return (
      <div className="miniapp">
        <div className="ma-skel-hero" />
        <div className="ma-skel" />
        <div className="ma-skel short" />
      </div>
    );
  }

  if (!initData) {
    return (
      <div className="miniapp">
        <div className="ma-panel">
          <div className="ma-kicker">Пятёрка на бульваре</div>
          <h1 className="ma-title">Открой из Telegram</h1>
          <p className="ma-lead">Нажми «Открыть приложение» в боте — подтянутся кг и сумма.</p>
        </div>
      </div>
    );
  }

  if (!home) {
    return (
      <div className="miniapp">
        <div className="ma-panel">
          <h1 className="ma-title">Не открылось</h1>
          <p className="ma-lead">{error}</p>
        </div>
      </div>
    );
  }

  const periodOpen = home.period?.status === "open";
  const contextLabel = todaySelected
    ? myDay
      ? `Сегодня, ${DAY_SHORT[weekdayFromIso(date)]}`
      : `Сегодня · не твой день`
    : `${DAY_SHORT[weekdayFromIso(date)]} ${fmtHuman(date)}`;
  const contextWho = myDay
    ? "кг запишем тебе"
    : forPerson
      ? `день ${firstName(forPerson.name)} · кг тебе`
      : "кг запишем тебе";
  const dayClosed = Boolean(
    home.me?.entries.some(
      (entry) => entry.date === date && entry.status !== "rejected",
    ),
  );
  const canSkip = Boolean(
    myDay && periodOpen && date && date <= home.today.date && !dayClosed,
  );

  return (
    <div className="miniapp">
      <header className="ma-head">
        <div>
          <div className="ma-kicker">Пятёрка на бульваре</div>
          <h1 className="ma-hello">{home.collector?.name ?? home.telegram.firstName}</h1>
        </div>
        {home.period ? (
          <div className="ma-week">
            {fmtHuman(home.period.startDate)} – {fmtHuman(home.period.endDate)}
          </div>
        ) : null}
      </header>

      {!home.collector ? (
        <button
          type="button"
          className="ma-panel"
          onClick={() => void copyText(home.telegram.id, "Telegram ID скопирован")}
        >
          <div className="ma-kicker">Нет в списке</div>
          <p className="ma-lead">Покажи организатору свой ID — нажми, чтобы скопировать.</p>
          <div className="ma-id">{home.telegram.id}</div>
        </button>
      ) : null}

      {home.collector && !home.collector.active ? (
        <div className="ma-panel">
          <div className="ma-kicker">Скрыт в графике</div>
          <p className="ma-lead">Напиши организатору, чтобы снова появиться в списке.</p>
        </div>
      ) : null}

      {home.me ? (
        <section className="ma-hero">
          <div className="ma-hero-top">
            <span>К переводу</span>
            {home.me.paidAt ? (
              <span className="ma-pill ok">перевёл</span>
            ) : home.me.kg > 0 ? (
              <span className="ma-pill wait">ещё нет</span>
            ) : (
              <span className="ma-pill">0 кг</span>
            )}
          </div>
          <div className="ma-amount">{formatMoney(home.me.amountRub)} ₽</div>
          <div className="ma-hero-meta">
            <span>
              {formatKg(home.me.kg)} кг
              {home.period ? ` × ${formatMoney(home.period.rate)} ₽` : ""}
            </span>
            {home.collector?.dayOfWeek !== null && home.collector?.dayOfWeek !== undefined ? (
              <span>{DAY_NAMES[home.collector.dayOfWeek]}</span>
            ) : null}
          </div>
          {home.settings ? (
            <button
              type="button"
              className="ma-pay"
              onClick={() => void copyText(home.settings?.payTo ?? "", "Карта скопирована")}
            >
              <span>
                <strong>{home.settings.payTo}</strong>
                <small>
                  {home.settings.bank} · {home.settings.deadlineText}
                </small>
              </span>
              <IconCopy />
            </button>
          ) : null}
        </section>
      ) : (
        <section className="ma-panel">
          <div className="ma-kicker">Период</div>
          <p className="ma-lead">
            {home.period ? "Неделя открыта — можно сдавать." : "Неделя ещё не открыта. Обычно с понедельника."}
          </p>
        </section>
      )}

      {home.me && home.me.gaps.length > 0 ? (
        <button
          type="button"
          className="ma-alert"
          onClick={() => {
            const first = home.me?.gaps[0]?.date;
            if (first) {
              pickDate(first, { scroll: true });
            }
          }}
        >
          <span>
            Пропуск: {home.me.gaps.map((gap) => fmtHuman(gap.date)).join(", ")}
          </span>
          <span>внести</span>
        </button>
      ) : null}

      {home.collector?.active && home.period && periodOpen ? (
        <form className="ma-sheet" ref={formRef} onSubmit={(event) => void onSubmit(event)}>
          <div className="ma-sheet-head">
            <div>
              <div className="ma-kicker">Сдать</div>
              <h2>Ведомость и кг</h2>
            </div>
            <button
              type="button"
              className="ma-ghost"
              onClick={() => {
                haptic("select");
                setDayOpen((value) => !value);
              }}
            >
              {dayOpen ? "Готово" : "Другой день"}
            </button>
          </div>

          <button
            type="button"
            className="ma-context"
            onClick={() => {
              haptic("select");
              setDayOpen((value) => !value);
            }}
          >
            <span>
              <strong>{contextLabel}</strong>
              <small>{contextWho}</small>
            </span>
            <span className="ma-chevron">{dayOpen ? "↑" : "↓"}</span>
          </button>

          {dayOpen ? (
            <div className="ma-days" role="listbox" aria-label="День">
              {openDays(home).map((day) => {
                const mine =
                  home.collector?.dayOfWeek !== null && day.weekday === home.collector?.dayOfWeek;
                const other = day.scheduled.find((person) => person._id !== home.collector?._id);
                const selected = date === day.date;
                const isToday = day.date === home.today.date;
                return (
                  <button
                    type="button"
                    key={day.date}
                    role="option"
                    aria-selected={selected}
                    className={`ma-day${selected ? " on" : ""}${isToday ? " now" : ""}`}
                    onClick={() => pickDate(day.date)}
                  >
                    <em>{isToday ? "сегодня" : DAY_SHORT[day.weekday]}</em>
                    <strong>{fmtHuman(day.date)}</strong>
                    <small>{mine ? "ты" : other ? firstName(other.name) : "—"}</small>
                  </button>
                );
              })}
            </div>
          ) : null}

          {showWho ? (
            <div className="ma-who">
              <div className="ma-kicker">За кого взял</div>
              <p className="ma-plus dim" style={{ margin: "0 0 8px" }}>
                День закроется у него, кг и сумма — тебе.
              </p>
              <div className="ma-people">
                {whoOptions.map((person) => (
                  <button
                    type="button"
                    key={person._id}
                    className={`ma-person${(forId || whoOptions[0]?._id) === person._id ? " on" : ""}`}
                    onClick={() => {
                      haptic("select");
                      setForId(person._id);
                    }}
                  >
                    <span className="ma-ava slot">{initials(person.name)}</span>
                    {firstName(person.name)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <label className="ma-kg-block" htmlFor="maKg">
            <span className="ma-kicker">Килограммы</span>
            <div className="ma-kg-line">
              <input
                id="maKg"
                ref={kgInput}
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
              <span className="ma-plus">+ {formatMoney(amountPreview)} ₽ к сумме</span>
            ) : (
              <span className="ma-plus dim">Можно только фото — кг проставит организатор</span>
            )}
          </label>

          <div className="ma-photo-block">
            <span className="ma-kicker">Ведомость</span>
            <input
              ref={cameraInput}
              className="ma-file"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(event) => setPhoto(event.target.files?.[0] ?? null)}
            />
            <input
              ref={galleryInput}
              className="ma-file"
              type="file"
              accept="image/*"
              onChange={(event) => setPhoto(event.target.files?.[0] ?? null)}
            />
            {photoUrl ? (
              <div className="ma-preview">
                <img src={photoUrl} alt="Ведомость" />
                <button type="button" className="ma-preview-x" onClick={() => setPhoto(null)}>
                  Убрать
                </button>
              </div>
            ) : (
              <div className="ma-photo-actions">
                <button type="button" className="ma-shot" onClick={() => cameraInput.current?.click()}>
                  <IconCam />
                  Снять
                </button>
                <button type="button" className="ma-shot alt" onClick={() => galleryInput.current?.click()}>
                  Из галереи
                </button>
              </div>
            )}
          </div>

          <div className="ma-dock">
            {canSkip ? (
              <button
                type="button"
                className="ma-skip"
                disabled={busy}
                onClick={() => void onSkipDay()}
              >
                Не брал
              </button>
            ) : null}
            <button className="ma-go" disabled={busy || !canSubmit}>
              {submitLabel()}
            </button>
          </div>
        </form>
      ) : null}

      {home.me ? (
        <section className="ma-panel ma-log">
          <div className="ma-kicker">Записи</div>
          {home.me.entries.length === 0 ? (
            <p className="ma-lead">Пока пусто — сдай первую ведомость.</p>
          ) : (
            <ul>
              {home.me.entries.map((entry) => (
                <li key={entry._id}>
                  <span>
                    <strong>
                      {fmtHuman(entry.date)}
                      {entry.status === "skipped"
                        ? " · не брал"
                        : entry.kg !== undefined
                          ? ` · ${formatKg(entry.kg)} кг`
                          : entry.hasPhoto
                            ? " · фото"
                            : ""}
                    </strong>
                    {entry.creditedForName ? (
                      <small>за {firstName(entry.creditedForName)}</small>
                    ) : null}
                    {entry.creditedByName ? (
                      <small>день закрыл {firstName(entry.creditedByName)}</small>
                    ) : null}
                  </span>
                  <em className={entry.status}>{statusCopy(entry.status)}</em>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {error ? <div className="ma-toast bad">{error}</div> : null}
      {toast ? <div className="ma-toast">{toast}</div> : null}
    </div>
  );
}
