import { useEffect, useState } from "react";
import { IconPhoto } from "../components/Icons";
import { PageHeader } from "../components/PageHeader";
import { api, type Dashboard, type MissingReport, type Settlement, type SettlementMismatch } from "../lib/api";
import {
  dayName,
  errorMessage,
  formatKg,
  formatRub,
  fmtShort,
  initials,
  parseKg,
  periodLabel,
} from "../lib/format";
import { ApiError } from "../lib/http";
import { useApiQuery } from "../lib/useApi";
import { useSession } from "../session";

type Props = {
  periodId: string;
  onPeriod: (id: string) => void;
};

type GapGroup = {
  collectorId: string;
  collectorName: string;
  hasMessenger: boolean;
  dates: string[];
};

function PendingPhoto({
  entryId,
  token,
  hasPhoto,
}: {
  entryId: string;
  token: string;
  hasPhoto: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hasPhoto || !root) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
        }
      },
      { rootMargin: "80px" },
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, [hasPhoto, root]);

  useEffect(() => {
    if (!hasPhoto || !visible) {
      return;
    }
    let objectUrl: string | undefined;
    let cancelled = false;
    fetch(`/api/entries/${entryId}/photo`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((response) => (response.ok ? response.blob() : null))
      .then((blob) => {
        if (!blob || cancelled) {
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        // Keep placeholder if Telegram file expired or upload is missing.
      });
    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [entryId, token, hasPhoto, visible]);

  if (url) {
    return <img className="photo-ph photo-thumb" src={url} alt="" />;
  }
  return (
    <div className="photo-ph" ref={setRoot}>
      <IconPhoto />
    </div>
  );
}

function mismatchFromError(err: unknown): SettlementMismatch | null {
  if (!(err instanceof ApiError)) {
    return null;
  }
  const details = err.details;
  if (typeof details !== "object" || details === null || !("mismatch" in details)) {
    return null;
  }
  const value = details.mismatch;
  if (typeof value !== "object" || value === null || !("diffKg" in value) || !("missing" in value)) {
    return null;
  }
  return value as SettlementMismatch;
}

function diffKgText(diff: number): string {
  if (Math.abs(diff) < 0.05) {
    return "кг совпали";
  }
  const kg = formatKg(Math.abs(diff));
  return diff > 0 ? `не хватает ${kg} кг` : `лишние ${kg} кг`;
}

function diffRubText(diff: number): string {
  if (Math.round(diff) === 0) {
    return "сумма совпала";
  }
  const rub = formatRub(Math.abs(diff));
  return diff > 0 ? `не хватает ${rub} ₽` : `лишние ${rub} ₽`;
}

function groupGaps(gaps: Dashboard["gaps"]): GapGroup[] {
  const groups = new Map<string, GapGroup>();
  for (const gap of gaps) {
    const existing = groups.get(gap.collectorId);
    if (existing) {
      existing.dates.push(gap.date);
    } else {
      groups.set(gap.collectorId, {
        collectorId: gap.collectorId,
        collectorName: gap.collectorName,
        hasMessenger: gap.hasTelegram || gap.hasMax,
        dates: [gap.date],
      });
    }
  }
  return [...groups.values()];
}

function MissingKgEditor({
  people,
  kgDraft,
  busyId,
  onDraft,
  onSave,
  onSkip,
}: {
  people: MissingReport[];
  kgDraft: Record<string, string>;
  busyId: string | null;
  onDraft: (key: string, value: string) => void;
  onSave: (collectorId: string, date: string) => void;
  onSkip: (collectorId: string, date: string) => void;
}) {
  if (people.length === 0) {
    return null;
  }
  return (
    <>
      {people.map((person) => (
        <div className="gap-item gap-kg" key={person.collectorId}>
          <div>
            <div>{person.collectorName}</div>
            {person.dates.map((date) => {
              const key = `${person.collectorId}:${date}`;
              return (
                <div className="review-actions" key={date}>
                  <span className="d">
                    {fmtShort(date)} · {dayName(date)}
                  </span>
                  <input
                    type="number"
                    min="0.1"
                    step="0.1"
                    placeholder="кг"
                    value={kgDraft[key] ?? ""}
                    onChange={(event) => onDraft(key, event.target.value)}
                  />
                  <button
                    type="button"
                    className="btn-confirm"
                    disabled={busyId === `kg-${key}`}
                    onClick={() => onSave(person.collectorId, date)}
                  >
                    {busyId === `kg-${key}` ? "…" : "Внести"}
                  </button>
                  <button
                    type="button"
                    className="btn-quiet"
                    disabled={busyId === `skip-${key}`}
                    onClick={() => onSkip(person.collectorId, date)}
                  >
                    {busyId === `skip-${key}` ? "…" : "Не брал"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}

export function HomePage({ periodId, onPeriod }: Props) {
  const { token, refreshData } = useSession();
  const [showMessage, setShowMessage] = useState(false);
  const [settlement, setSettlement] = useState<Settlement | null>(null);
  const [calcOpen, setCalcOpen] = useState(false);
  const [calcPreview, setCalcPreview] = useState<Settlement | null>(null);
  const [storeKg, setStoreKg] = useState("");
  const [storeRub, setStoreRub] = useState("");
  const [mismatch, setMismatch] = useState<SettlementMismatch | null>(null);
  const [kgDraft, setKgDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data: dashboard } = useApiQuery(
    Boolean(token),
    () => api.dashboard(token ?? "", periodId),
    [token, periodId],
  );
  const { data: pending } = useApiQuery(
    Boolean(token),
    () => api.entries.listPending(token ?? "", periodId),
    [token, periodId],
  );
  const { data: loadedSettlement } = useApiQuery(
    Boolean(token),
    () => api.payments.current(token ?? ""),
    [token],
  );
  const { data: lastWeekPreview } = useApiQuery(
    Boolean(token) && loadedSettlement === null,
    () => api.payments.preview(token ?? ""),
    [token, loadedSettlement],
  );
  const { data: summary } = useApiQuery(
    Boolean(token) && showMessage && !settlement?.text,
    () => api.summary(token ?? "", periodId),
    [token, periodId, showMessage, settlement?.text],
  );

  const view = settlement ?? loadedSettlement;
  const lastWeek = view ?? lastWeekPreview;
  const lastWeekMissing =
    lastWeek && !lastWeek.settled ? (lastWeek.missing ?? []) : [];

  async function onConfirm(entryId: string, fallbackKg: number | undefined) {
    if (!token) {
      return;
    }
    const raw = kgDraft[entryId] ?? (fallbackKg !== undefined ? String(fallbackKg) : "");
    const kg = parseKg(raw);
    if (kg === undefined) {
      setError("Укажите кг больше нуля");
      return;
    }
    setError(null);
    setBusyId(entryId);
    try {
      await api.entries.confirm(token, entryId, kg);
      refreshData();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function onReject(entryId: string) {
    if (!token) {
      return;
    }
    if (!window.confirm("Отклонить эту накладную?")) {
      return;
    }
    setError(null);
    setBusyId(entryId);
    try {
      await api.entries.reject(token, entryId);
      refreshData();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function refreshLastWeekPreview() {
    if (!token) {
      return null;
    }
    const preview = await api.payments.preview(token);
    setCalcPreview(preview);
    if (preview && mismatch) {
      const storeKgValue = Number(storeKg);
      const storeRubValue = Number(storeRub);
      setMismatch({
        ...mismatch,
        collectedKg: preview.totalKg,
        collectedRub: preview.totalRub,
        diffKg: Number.isFinite(storeKgValue) ? storeKgValue - preview.totalKg : mismatch.diffKg,
        diffRub: Number.isFinite(storeRubValue)
          ? storeRubValue - preview.totalRub
          : mismatch.diffRub,
        missing: preview.missing ?? [],
        pending: preview.pending ?? [],
      });
    }
    return preview;
  }

  async function onAdminKg(targetPeriodId: string, collectorId: string, date: string) {
    if (!token) {
      return;
    }
    const key = `${collectorId}:${date}`;
    const kg = parseKg(kgDraft[key] ?? "");
    if (kg === undefined) {
      setError("Укажите кг больше нуля");
      return;
    }
    setError(null);
    setToast(null);
    setBusyId(`kg-${key}`);
    try {
      await api.entries.createManual(token, {
        periodId: targetPeriodId,
        collectorId,
        date,
        kg,
      });
      setKgDraft((prev) => ({ ...prev, [key]: "" }));
      refreshData();
      if (calcOpen) {
        await refreshLastWeekPreview();
      }
      setToast("Кг внесены");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function onSkip(targetPeriodId: string, collectorId: string, date: string) {
    if (!token) {
      return;
    }
    const key = `${collectorId}:${date}`;
    setError(null);
    setToast(null);
    setBusyId(`skip-${key}`);
    try {
      await api.entries.skip(token, {
        periodId: targetPeriodId,
        collectorId,
        date,
      });
      refreshData();
      if (calcOpen) {
        await refreshLastWeekPreview();
      }
      setToast("Отметили: не брал");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function onPaid(collectorId: string) {
    if (!token || !view) {
      return;
    }
    setError(null);
    setBusyId(collectorId);
    try {
      const result = await api.payments.markPaid(token, view.periodId, collectorId);
      setSettlement({ ...result.settlement, text: settlement?.text ?? view.text });
      refreshData();
      setToast(
        result.periodClosed ? "Все оплатили — период закрыт" : "Оплата отмечена",
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function openCalculate() {
    if (!token) {
      return;
    }
    setError(null);
    setToast(null);
    setMismatch(null);
    setBusyId("calculate");
    try {
      const preview = await api.payments.preview(token);
      if (!preview) {
        setError("Прошлой недели в системе ещё нет — нечего считать");
        return;
      }
      setCalcPreview(preview);
      const kg = preview.totalKg > 0 ? String(preview.totalKg) : "";
      setStoreKg(kg);
      setStoreRub(
        preview.storeTotalRub && preview.storeTotalRub > 0
          ? String(preview.storeTotalRub)
          : kg
            ? String(Math.round(Number(kg) * preview.rate))
            : "",
      );
      setCalcOpen(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function onCalculate() {
    if (!token) {
      return;
    }
    const kg = parseKg(storeKg);
    const totalRub = parseKg(storeRub);
    if (kg === undefined) {
      setError("Укажите кг из счёта магазина");
      return;
    }
    if (totalRub === undefined) {
      setError("Укажите сумму из счёта магазина");
      return;
    }
    setError(null);
    setToast(null);
    setMismatch(null);
    setBusyId("calculate");
    try {
      const result = await api.payments.calculate(token, {
        storeKg: kg,
        storeTotalRub: totalRub,
      });
      setSettlement(result);
      setShowMessage(Boolean(result.text));
      setCalcOpen(false);
      if (result.periodId !== periodId) {
        onPeriod(result.periodId);
      }
      refreshData();
      const skipped = result.invoices?.skipped ?? [];
      if (skipped.length === 0) {
        setToast("Расчёт готов, счета отправлены участникам");
      } else {
        const names = skipped
          .map((item) => `${item.collectorName} (${errorMessage(new Error(item.reason))})`)
          .join("; ");
        setToast(`Расчёт готов. Счета: ${result.invoices?.sent ?? 0}. Не ушло: ${names}`);
      }
    } catch (err) {
      setMismatch(mismatchFromError(err));
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function copySummary() {
    const text = view?.text ?? summary?.text;
    if (!text) {
      return;
    }
    await navigator.clipboard.writeText(text);
    setToast("Скопировано");
  }

  async function sendSummary() {
    if (!token) {
      return;
    }
    setError(null);
    setBusyId("summary");
    try {
      await api.sendSummary(token, view?.periodId ?? periodId);
      setToast("Отправлено в группу ✓");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function remind(collectorId: string, kind: "report" | "payment", canSend: boolean) {
    if (!token) {
      return;
    }
    const targetPeriodId = kind === "payment" ? (view?.periodId ?? periodId) : periodId;
    const busyKey = `remind-${kind}-${collectorId}`;
    setError(null);
    setToast(null);
    setBusyId(busyKey);
    try {
      if (canSend) {
        await api.sendReminder(token, targetPeriodId, collectorId, kind);
        setToast("Напоминание отправлено ✓");
        return;
      }
      const preview = await api.reminderPreview(token, targetPeriodId, collectorId, kind);
      await navigator.clipboard.writeText(preview.text);
      setToast("Нет ID в боте — текст скопирован");
    } catch (err) {
      try {
        const preview = await api.reminderPreview(token, targetPeriodId, collectorId, kind);
        await navigator.clipboard.writeText(preview.text);
        setError(`${errorMessage(err)}. Текст скопирован.`);
      } catch {
        setError(errorMessage(err));
      }
    } finally {
      setBusyId(null);
    }
  }

  if (dashboard === undefined) {
    return <div className="loading">Загрузка…</div>;
  }

  const pendingCount = pending?.length ?? dashboard.pendingCount;
  const gapCount = dashboard.gaps.length;

  return (
    <>
      <PageHeader
        title="Главная"
        sub="Сначала то, что нужно закрыть руками — потом цифры и расчёт"
        actions={
          view?.settled ? undefined : (
            <button
              type="button"
              className="btn-primary"
              disabled={busyId === "calculate"}
              onClick={() => void openCalculate()}
            >
              {busyId === "calculate" && !calcOpen ? "…" : "Рассчитать неделю"}
            </button>
          )
        }
      />

      <div className="hero">
        <div className="hero-kicker">Собрано за выбранную неделю</div>
        <div className="hero-amount">{formatKg(dashboard.confirmedKg)} кг</div>
        <div className="hero-meta">
          <span>{formatRub(dashboard.confirmedRub)} ₽ по подтверждённым записям</span>
          <span>
            счёт магазина: {formatKg(dashboard.expectedKg)} кг · {formatRub(dashboard.expectedRub)} ₽
          </span>
        </div>
        <div className="progress">
          <div className="fill" style={{ width: `${dashboard.percent}%` }} />
        </div>
        <div className="h2-sub">
          {dashboard.percent}% от ожидаемого
          {dashboard.status === "open" ? " — неделя ещё открыта" : " — неделя закрыта"}
        </div>
      </div>

      <div className="work-grid">
        <div className="card">
          <div className="card-head">
            <h2>Накладные</h2>
            <span className={`badge ${pendingCount ? "warn" : "ok"}`}>{pendingCount}</span>
          </div>
          <p className="h2-sub">Фото от сборщиков. Подтверди кг — тогда они попадут в сумму.</p>
          {pending === undefined ? (
            <div className="loading">Загрузка…</div>
          ) : pending.length === 0 ? (
            <div className="empty">Всё проверено</div>
          ) : (
            pending.map((item) => (
              <div className="review-item" key={item._id}>
                <div className="review-top">
                  <PendingPhoto
                    entryId={item._id}
                    token={token ?? ""}
                    hasPhoto={Boolean(item.hasPhoto ?? item.telegramFileId)}
                  />
                  <div className="review-info">
                    <div className="name">{item.creditedByName ?? item.collectorName}</div>
                    <div className="meta">
                      {fmtShort(item.date)} · {dayName(item.date)}
                      {item.creditedByName ? ` · за ${item.collectorName}` : ""}
                      {item.hasPhoto || item.telegramFileId ? " · есть фото" : " · без фото"}
                    </div>
                  </div>
                </div>
                <div className="review-actions">
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    placeholder="кг"
                    value={kgDraft[item._id] ?? (item.kg !== undefined ? String(item.kg) : "")}
                    onChange={(event) =>
                      setKgDraft((prev) => ({ ...prev, [item._id]: event.target.value }))
                    }
                  />
                  <button
                    type="button"
                    className="btn-confirm"
                    disabled={busyId === item._id || dashboard.settled}
                    onClick={() => void onConfirm(item._id, item.kg)}
                  >
                    Подтвердить
                  </button>
                  <button
                    type="button"
                    className="btn-reject"
                    disabled={busyId === item._id || dashboard.settled}
                    onClick={() => void onReject(item._id)}
                  >
                    Отклонить
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Пропуски</h2>
            <span className={`badge ${gapCount ? "info" : "ok"}`}>{gapCount}</span>
          </div>
          <p className="h2-sub">Дни по графику без записи. Можно внести кг, отметить «Не брал» или напомнить.</p>
          {dashboard.gaps.length === 0 ? (
            <div className="empty">Пропусков нет</div>
          ) : (
            groupGaps(dashboard.gaps).map((group) => (
              <div className="gap-item gap-kg" key={group.collectorId}>
                <div className="person-row">
                  <span className="avatar">{initials(group.collectorName)}</span>
                  <div>
                    <div className="name">{group.collectorName}</div>
                    {dashboard.settled ? (
                      <div className="dates" style={{ textAlign: "left", marginTop: 4 }}>
                        {group.dates.map((date) => (
                          <span key={date}>
                            {fmtShort(date)} · {dayName(date)}
                          </span>
                        ))}
                      </div>
                    ) : (
                      group.dates.map((date) => {
                        const key = `${group.collectorId}:${date}`;
                        return (
                          <div className="review-actions" key={date}>
                            <span className="d">
                              {fmtShort(date)} · {dayName(date)}
                            </span>
                            <input
                              type="number"
                              min="0.1"
                              step="0.1"
                              placeholder="кг"
                              value={kgDraft[key] ?? ""}
                              onChange={(event) =>
                                setKgDraft((prev) => ({ ...prev, [key]: event.target.value }))
                              }
                            />
                            <button
                              type="button"
                              className="btn-confirm"
                              disabled={busyId === `kg-${key}`}
                              onClick={() => void onAdminKg(periodId, group.collectorId, date)}
                            >
                              {busyId === `kg-${key}` ? "…" : "Внести"}
                            </button>
                            <button
                              type="button"
                              className="btn-quiet"
                              disabled={busyId === `skip-${key}`}
                              onClick={() => void onSkip(periodId, group.collectorId, date)}
                            >
                              {busyId === `skip-${key}` ? "…" : "Не брал"}
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
                <div className="row-actions">
                  <button
                    type="button"
                    className="btn-quiet"
                    disabled={busyId === `remind-report-${group.collectorId}`}
                    onClick={() => void remind(group.collectorId, "report", group.hasMessenger)}
                  >
                    {busyId === `remind-report-${group.collectorId}`
                      ? "…"
                      : group.hasMessenger
                        ? "Напомнить"
                        : "Скопировать"}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Расчёт прошлой недели</h2>
            <p className="h2-sub" style={{ marginBottom: 0 }}>
              Счёт магазина сверяется с кг участников. Пока неделя не оплачена, недостающие кг можно
              внести здесь.
            </p>
          </div>
        </div>
        {view?.settled ? (
          <div className="empty" style={{ textAlign: "left" }}>
            Прошлая неделя закрыта — все оплатили. В новый расчёт она не попадёт.
          </div>
        ) : !view ? (
          <div className="empty" style={{ textAlign: "left", paddingTop: 8 }}>
            Когда будет счёт магазина — нажми «Рассчитать неделю» сверху.
          </div>
        ) : null}
        {lastWeek && lastWeekMissing.length > 0 ? (
          <>
            <div className="h2-sub" style={{ marginTop: 16 }}>
              Не внесли кг за {periodLabel(lastWeek.startDate, lastWeek.endDate)}
            </div>
            <MissingKgEditor
              people={lastWeekMissing}
              kgDraft={kgDraft}
              busyId={busyId}
              onDraft={(key, value) => setKgDraft((prev) => ({ ...prev, [key]: value }))}
              onSave={(collectorId, date) => void onAdminKg(lastWeek.periodId, collectorId, date)}
              onSkip={(collectorId, date) => void onSkip(lastWeek.periodId, collectorId, date)}
            />
          </>
        ) : null}
        {view ? (
          <>
            <div className="h2-sub" style={{ marginTop: 16 }}>
              {periodLabel(view.startDate, view.endDate)} · {view.rate} ₽/кг
              {view.settled ? " · закрыт" : ""}
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Участник</th>
                    <th>Кг</th>
                    <th>Сумма</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {view.rows.map((row) => (
                    <tr key={row.collectorId}>
                      <td>{row.collectorName}</td>
                      <td>{formatKg(row.kg)} кг</td>
                      <td>{formatRub(row.amountRub)} ₽</td>
                      <td>
                        <div className="row-actions">
                          {row.paidAt || view.settled ? (
                            <span className="badge ok">оплатил</span>
                          ) : (
                            <button
                              type="button"
                              className="btn-confirm"
                              disabled={busyId === row.collectorId}
                              onClick={() => void onPaid(row.collectorId)}
                            >
                              {busyId === row.collectorId ? "…" : "Оплатил"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Итого</td>
                    <td>{formatKg(view.totalKg)} кг</td>
                    <td>{formatRub(view.totalRub)} ₽</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        ) : null}
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Сводка в группу</h2>
            <p className="h2-sub" style={{ marginBottom: 0 }}>
              Текст для группы Telegram или MAX. Если чат не привязан, можно скопировать вручную.
            </p>
          </div>
          <button type="button" className="btn-secondary" onClick={() => setShowMessage((value) => !value)}>
            {showMessage ? "Скрыть" : "Показать текст"}
          </button>
        </div>
        {showMessage ? (
          view?.text || summary ? (
            <>
              <textarea readOnly value={view?.text ?? summary?.text ?? ""} />
              <div className="msg-actions">
                <button type="button" className="btn-secondary" onClick={() => void copySummary()}>
                  Скопировать
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busyId === "summary"}
                  onClick={() => void sendSummary()}
                >
                  {busyId === "summary" ? "Отправляем…" : "Отправить в группу"}
                </button>
              </div>
            </>
          ) : (
            <div className="loading">Собираем текст…</div>
          )
        ) : null}
      </div>
      {calcOpen ? (
        <div className="overlay" onClick={() => setCalcOpen(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div>
                <h2>Расчёт</h2>
                <p className="h2-sub">
                  {calcPreview
                    ? periodLabel(calcPreview.startDate, calcPreview.endDate)
                    : "Прошлая неделя"}
                  {" · "}
                  {calcPreview?.rate ?? 20} ₽/кг
                </p>
              </div>
              <button type="button" className="btn-ghost" onClick={() => setCalcOpen(false)}>
                Закрыть
              </button>
            </div>
            {calcPreview ? (
              <div className="stat-row" style={{ marginBottom: 14 }}>
                <span>Собрано у участников</span>
                <span className="val">
                  {formatKg(calcPreview.totalKg)} кг · {formatRub(calcPreview.totalRub)} ₽
                </span>
              </div>
            ) : null}
            {calcPreview &&
            !mismatch &&
            (calcPreview.missing?.length ?? 0) > 0 &&
            !calcPreview.settled ? (
              <>
                <div className="mismatch-section" style={{ marginTop: 0 }}>
                  Не внесли кг — можно указать вручную
                </div>
                <MissingKgEditor
                  people={calcPreview.missing ?? []}
                  kgDraft={kgDraft}
                  busyId={busyId}
                  onDraft={(key, value) => setKgDraft((prev) => ({ ...prev, [key]: value }))}
                  onSave={(collectorId, date) =>
                    void onAdminKg(calcPreview.periodId, collectorId, date)
                  }
                  onSkip={(collectorId, date) =>
                    void onSkip(calcPreview.periodId, collectorId, date)
                  }
                />
              </>
            ) : null}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void onCalculate();
              }}
            >
              <div className="grid2">
                <div className="field">
                  <label htmlFor="storeKg">Кг по счёту магазина</label>
                  <input
                    id="storeKg"
                    type="number"
                    min="0"
                    step="0.1"
                    value={storeKg}
                    onChange={(event) => {
                      const next = event.target.value;
                      setStoreKg(next);
                      const kg = Number(next);
                      if (Number.isFinite(kg) && kg > 0) {
                        setStoreRub(String(Math.round(kg * (calcPreview?.rate ?? 20))));
                      }
                    }}
                  />
                </div>
                <div className="field">
                  <label htmlFor="storeRub">Сумма по счёту магазина, ₽</label>
                  <input
                    id="storeRub"
                    type="number"
                    min="0"
                    value={storeRub}
                    onChange={(event) => setStoreRub(event.target.value)}
                  />
                </div>
              </div>
              <p className="h2-sub">
                Итог по участникам должен совпасть со счётом. Тогда каждому уйдёт сообщение: период,
                сумма и куда переводить.
              </p>
              {mismatch ? (
                <div className="mismatch">
                  <div className="mismatch-title">Итог не сходится со счётом</div>
                  <div className="stat-row">
                    <span>Участники</span>
                    <span className="val">
                      {formatKg(mismatch.collectedKg)} кг · {formatRub(mismatch.collectedRub)} ₽
                    </span>
                  </div>
                  <div className="stat-row">
                    <span>Магазин</span>
                    <span className="val">
                      {formatKg(mismatch.storeKg)} кг · {formatRub(mismatch.storeRub)} ₽
                    </span>
                  </div>
                  <div className="stat-row mismatch-diff">
                    <span>Разница</span>
                    <span className="val">
                      {diffKgText(mismatch.diffKg)} · {diffRubText(mismatch.diffRub)}
                    </span>
                  </div>
                  <div className="mismatch-section">Не внесли отчёт</div>
                  {mismatch.missing.length === 0 ? (
                    <div className="empty">Все по графику внесли отчёт</div>
                  ) : calcPreview && !calcPreview.settled ? (
                    <MissingKgEditor
                      people={mismatch.missing}
                      kgDraft={kgDraft}
                      busyId={busyId}
                      onDraft={(key, value) => setKgDraft((prev) => ({ ...prev, [key]: value }))}
                      onSave={(collectorId, date) =>
                        void onAdminKg(calcPreview.periodId, collectorId, date)
                      }
                      onSkip={(collectorId, date) =>
                        void onSkip(calcPreview.periodId, collectorId, date)
                      }
                    />
                  ) : (
                    mismatch.missing.map((person) => (
                      <div className="gap-item" key={person.collectorId}>
                        <div>{person.collectorName}</div>
                        <div className="dates">
                          {person.dates.map((date) => (
                            <span key={date}>
                              {fmtShort(date)} · {dayName(date)}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                  {mismatch.pending.length > 0 ? (
                    <>
                      <div className="mismatch-section">На проверке — ещё не в сумме</div>
                      {mismatch.pending.map((person) => (
                        <div className="gap-item" key={person.collectorId}>
                          <div>{person.collectorName}</div>
                          <div className="dates">
                            {person.dates.map((date) => (
                              <span key={date}>
                                {fmtShort(date)} · {dayName(date)}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </>
                  ) : null}
                </div>
              ) : null}
              {toast ? <div className="toast inline">{toast}</div> : null}
              {error ? <div className="err">{error}</div> : null}
              <div className="msg-actions">
                <button type="button" className="btn-secondary" onClick={() => setCalcOpen(false)}>
                  Отмена
                </button>
                <button type="submit" className="btn-primary" disabled={busyId === "calculate"}>
                  {busyId === "calculate" ? "Собираем…" : "Собрать расчёт"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
      {toast && !calcOpen ? <div className="toast">{toast}</div> : null}
      {error && !calcOpen ? <div className="toast bad">{error}</div> : null}
    </>
  );
}

