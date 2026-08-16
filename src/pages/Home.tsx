import { useState } from "react";
import { IconPhoto } from "../components/Icons";
import { api } from "../lib/api";
import {
  dayName,
  errorMessage,
  formatKg,
  formatRub,
  fmtShort,
} from "../lib/format";
import { useApiQuery } from "../lib/useApi";
import { useSession } from "../session";

type Props = {
  periodId: string;
};

export function HomePage({ periodId }: Props) {
  const { token, refreshData } = useSession();
  const [showMessage, setShowMessage] = useState(false);
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
  const { data: payments } = useApiQuery(
    Boolean(token),
    () => api.payments.list(token ?? "", periodId),
    [token, periodId],
  );
  const { data: summary } = useApiQuery(
    Boolean(token) && showMessage,
    () => api.summary(token ?? "", periodId),
    [token, periodId, showMessage],
  );

  async function onConfirm(entryId: string, fallbackKg: number | undefined) {
    if (!token) {
      return;
    }
    const raw = kgDraft[entryId] ?? (fallbackKg !== undefined ? String(fallbackKg) : "");
    const kg = Number(raw);
    if (!Number.isFinite(kg) || kg <= 0) {
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

  async function onPaid(collectorId: string) {
    if (!token) {
      return;
    }
    setError(null);
    setBusyId(collectorId);
    try {
      await api.payments.markPaid(token, periodId, collectorId);
      refreshData();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function copySummary() {
    if (!summary) {
      return;
    }
    await navigator.clipboard.writeText(summary.text);
    setToast("Скопировано");
  }

  if (dashboard === undefined) {
    return <div className="loading">Загрузка…</div>;
  }

  return (
    <>
      <h1 className="page-title">Главная</h1>
      <div className="page-sub">Что требует внимания прямо сейчас</div>

      <div className="card">
        <h2>Сколько собрано</h2>
        <div className="h2-sub">По подтверждённым записям, сравниваем с суммой от магазина</div>
        <div className="stat-row">
          <span>Собрано</span>
          <span className="val">
            {formatKg(dashboard.confirmedKg)} кг · {formatRub(dashboard.confirmedRub)} ₽
          </span>
        </div>
        <div className="stat-row">
          <span>Ожидается по сумме магазина</span>
          <span className="val">
            {formatKg(dashboard.expectedKg)} кг · {formatRub(dashboard.expectedRub)} ₽
          </span>
        </div>
        <div className="progress">
          <div className="fill" style={{ width: `${dashboard.percent}%` }} />
        </div>
        <div className="h2-sub" style={{ marginBottom: 0 }}>
          {dashboard.percent}% от ожидаемого
          {dashboard.status === "open" ? " — период ещё открыт, донабирается" : " — период закрыт"}
        </div>
      </div>

      <div className="card">
        <h2>
          Накладные на проверке{" "}
          <span className="badge warn">{pending?.length ?? dashboard.pendingCount}</span>
        </h2>
        <div className="h2-sub">Сборщики прислали фото — подтверди кг, чтобы они попали в сумму</div>
        {pending === undefined ? (
          <div className="loading">Загрузка…</div>
        ) : pending.length === 0 ? (
          <div className="empty">Всё проверено ✓</div>
        ) : (
          pending.map((item) => (
            <div className="review-item" key={item._id}>
              <div className="review-top">
                <div className="photo-ph">
                  <IconPhoto />
                </div>
                <div className="review-info">
                  <div className="name">{item.collectorName}</div>
                  <div className="meta">
                    {fmtShort(item.date)} · {dayName(item.date)}
                    {item.telegramFileId ? " · есть фото в Telegram" : " · фото пока нет"}
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
                  disabled={busyId === item._id || dashboard.status !== "open"}
                  onClick={() => void onConfirm(item._id, item.kg)}
                >
                  Подтвердить
                </button>
                <button
                  type="button"
                  className="btn-reject"
                  disabled={busyId === item._id || dashboard.status !== "open"}
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
        <h2>
          Пропуски <span className="badge info">{dashboard.gaps.length}</span>
        </h2>
        <div className="h2-sub">Дни по графику без единой записи</div>
        {dashboard.gaps.length === 0 ? (
          <div className="empty">Пропусков нет</div>
        ) : (
          dashboard.gaps.map((gap) => (
            <div className="gap-item" key={`${gap.collectorId}-${gap.date}`}>
              <span>{gap.collectorName}</span>
              <span className="d">
                {fmtShort(gap.date)} · {dayName(gap.date)}
              </span>
            </div>
          ))
        )}
      </div>

      <div className="card">
        <h2>Переводы</h2>
        <div className="h2-sub">Отметь, кто уже перевёл за период</div>
        {payments === undefined ? (
          <div className="loading">Загрузка…</div>
        ) : payments.length === 0 ? (
          <div className="empty">Подтверждённых кг пока нет</div>
        ) : (
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
              {payments.map((row) => (
                <tr key={row.collectorId}>
                  <td>{row.collectorName}</td>
                  <td>{formatKg(row.kg)} кг</td>
                  <td>{formatRub(row.amountRub)} ₽</td>
                  <td>
                    {row.paidAt ? (
                      <span className="badge ok">перевёл</span>
                    ) : (
                      <button
                        type="button"
                        className="toggle-pill off"
                        disabled={busyId === row.collectorId}
                        onClick={() => void onPaid(row.collectorId)}
                      >
                        отметить
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <button type="button" className="btn-primary" onClick={() => setShowMessage((value) => !value)}>
        {showMessage ? "Скрыть сообщение" : "Собрать сообщение для Telegram"}
      </button>
      {showMessage ? (
        <div className="card" style={{ marginTop: 12, maxWidth: 520 }}>
          <h2>Сообщение</h2>
          {summary === undefined ? (
            <div className="loading">Собираем текст…</div>
          ) : (
            <>
              <textarea readOnly value={summary.text} />
              <div className="msg-actions">
                <button type="button" className="btn-secondary" onClick={() => void copySummary()}>
                  Скопировать
                </button>
              </div>
              <div className="h2-sub" style={{ marginTop: 10, marginBottom: 0 }}>
                Отправка в группу ещё не подключена — скопируйте текст и вставьте в чат сами.
              </div>
              {toast ? <div className="toast">{toast}</div> : null}
            </>
          )}
        </div>
      ) : null}
      {error ? <div className="err">{error}</div> : null}
    </>
  );
}
