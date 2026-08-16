import { useState, type FormEvent } from "react";
import { api } from "../lib/api";
import {
  addDaysLocal,
  errorMessage,
  periodLabel,
  todayLocalIso,
} from "../lib/format";
import { useApiQuery } from "../lib/useApi";
import { useSession } from "../session";

type Props = {
  selectedId: string | null;
  onSelect: (id: string) => void;
};

export function PeriodPicker({ selectedId, onSelect }: Props) {
  const { token, refreshData } = useSession();
  const { data: periods } = useApiQuery(
    Boolean(token),
    () => api.periods.list(token ?? ""),
    [token],
  );
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [startDate, setStartDate] = useState(todayLocalIso);
  const [endDate, setEndDate] = useState(() => addDaysLocal(todayLocalIso(), 13));
  const [storeTotalRub, setStoreTotalRub] = useState("8000");
  const [rate, setRate] = useState("20");

  const selected = periods?.find((period) => period._id === selectedId);
  const openPeriod = periods?.find((period) => period.status === "open");
  const label = selected
    ? periodLabel(selected.startDate, selected.endDate)
    : "Нет периода";

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    if (!token) {
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const id = await api.periods.create(token, {
        startDate,
        endDate,
        storeTotalRub: Number(storeTotalRub),
        rate: Number(rate),
      });
      refreshData();
      onSelect(id);
      setOpen(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function onClose() {
    if (!openPeriod || !token) {
      return;
    }
    if (!window.confirm("Закрыть текущий открытый период? Новые записи в него больше не попадут.")) {
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await api.periods.close(token, openPeriod._id);
      refreshData();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="period-pill" onClick={() => setOpen(true)}>
        {label}
        <span className="arrow">▾</span>
      </button>
      {open ? (
        <div className="overlay" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h2>Периоды</h2>
            <div className="h2-sub">Двухнедельные окна сверки с магазином</div>
            {periods === undefined ? (
              <div className="loading">Загрузка…</div>
            ) : periods.length === 0 ? (
              <div className="empty">Периодов ещё нет</div>
            ) : (
              periods.map((period) => (
                <button
                  key={period._id}
                  type="button"
                  className={`period-row${period._id === selectedId ? " active" : ""}`}
                  onClick={() => {
                    onSelect(period._id);
                    setOpen(false);
                  }}
                >
                  <span>{periodLabel(period.startDate, period.endDate)}</span>
                  <span className={`badge ${period.status === "open" ? "ok" : "info"}`}>
                    {period.status === "open" ? "открыт" : "закрыт"}
                  </span>
                </button>
              ))
            )}

            {openPeriod ? (
              <button className="btn-secondary" disabled={busy} onClick={() => void onClose()}>
                Закрыть открытый период
              </button>
            ) : null}

            <form onSubmit={(event) => void onCreate(event)} style={{ marginTop: 18 }}>
              <h2>Новый период</h2>
              <div className="h2-sub">
                {openPeriod
                  ? "Сначала закройте текущий открытый период"
                  : "Ставка копируется в период и больше не меняется задним числом"}
              </div>
              <div className="grid2">
                <div className="field">
                  <label htmlFor="pStart">Начало</label>
                  <input
                    id="pStart"
                    type="date"
                    value={startDate}
                    onChange={(event) => setStartDate(event.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="pEnd">Конец</label>
                  <input
                    id="pEnd"
                    type="date"
                    value={endDate}
                    onChange={(event) => setEndDate(event.target.value)}
                  />
                </div>
              </div>
              <div className="grid2">
                <div className="field">
                  <label htmlFor="pTotal">Сумма магазина, ₽</label>
                  <input
                    id="pTotal"
                    type="number"
                    min="0"
                    value={storeTotalRub}
                    onChange={(event) => setStoreTotalRub(event.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="pRate">Ставка, ₽/кг</label>
                  <input
                    id="pRate"
                    type="number"
                    min="1"
                    value={rate}
                    onChange={(event) => setRate(event.target.value)}
                  />
                </div>
              </div>
              {error ? <div className="err">{error}</div> : null}
              <button className="btn-primary" disabled={busy || Boolean(openPeriod)}>
                Создать период
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
