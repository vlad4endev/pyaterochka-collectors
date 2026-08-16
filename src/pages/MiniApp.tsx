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

function isMyScheduledDay(home: MiniHome, date: string): boolean {
  const day = home.days.find((item) => item.date === date);
  return Boolean(
    home.collector &&
      home.collector.dayOfWeek !== null &&
      day &&
      day.weekday === home.collector.dayOfWeek,
  );
}

function statusCopy(status: "pending" | "confirmed" | "rejected"): string {
  if (status === "confirmed") {
    return "принято";
  }
  if (status === "pending") {
    return "проверка";
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
          const next =
            current && value.days.some((day) => day.date === current)
              ? current
              : value.days.some((day) => day.date === value.today.date)
                ? value.today.date
                : (value.days[0]?.date ?? value.today.date);
          setForId((prev) => (current ? prev : defaultForId(value, next)));
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
  const todaySelected = Boolean(home && date === home.today.date);

  function pickDate(next: string, opts?: { scroll?: boolean }) {
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
      setDayOpen(false);
      haptic("success");
      setToast(
        showWho && forPerson
          ? `На ${firstName(forPerson.name)} · на проверке`
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
  const whoOptions: MiniPerson[] = home.others;
  const contextLabel = todaySelected
    ? myDay
      ? `Сегодня, ${DAY_SHORT[weekdayFromIso(date)]}`
      : `Сегодня · не твой день`
    : `${DAY_SHORT[weekdayFromIso(date)]} ${fmtHuman(date)}`;
  const contextWho = myDay ? "запишем на тебя" : forPerson ? `за ${firstName(forPerson.name)}` : "запишем на тебя";

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
              {home.days.map((day) => {
                const mine =
                  home.collector?.dayOfWeek !== null && day.weekday === home.collector?.dayOfWeek;
                const other = day.scheduled.find((person) => person._id !== home.collector?._id);
                const selected = date === day.date;
                return (
                  <button
                    type="button"
                    key={day.date}
                    role="option"
                    aria-selected={selected}
                    className={`ma-day${selected ? " on" : ""}${day.date === home.today.date ? " now" : ""}`}
                    onClick={() => pickDate(day.date)}
                  >
                    <em>{DAY_SHORT[day.weekday]}</em>
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
              <div className="ma-people">
                <button
                  type="button"
                  className={`ma-person${forId === "" ? " on" : ""}`}
                  onClick={() => {
                    haptic("select");
                    setForId("");
                  }}
                >
                  <span className="ma-ava me">Я</span>
                  Себе
                </button>
                {whoOptions.map((person) => {
                  const scheduled = selectedDay?.scheduled.some((row) => row._id === person._id);
                  return (
                    <button
                      type="button"
                      key={person._id}
                      className={`ma-person${forId === person._id ? " on" : ""}`}
                      onClick={() => {
                        haptic("select");
                        setForId(person._id);
                      }}
                    >
                      <span className={`ma-ava${scheduled ? " slot" : ""}`}>{initials(person.name)}</span>
                      {firstName(person.name)}
                    </button>
                  );
                })}
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
                      {entry.kg !== undefined
                        ? ` · ${formatKg(entry.kg)} кг`
                        : entry.hasPhoto
                          ? " · фото"
                          : ""}
                    </strong>
                    {entry.creditedForName ? (
                      <small>за {firstName(entry.creditedForName)}</small>
                    ) : null}
                    {entry.creditedByName ? (
                      <small>от {firstName(entry.creditedByName)}</small>
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
