import { useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { errorMessage, periodLabel } from "../lib/format";
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
  const [storeTotalRub, setStoreTotalRub] = useState("8000");
  const [rate, setRate] = useState("20");

  const selected = periods?.find((period) => period._id === selectedId);
  const openPeriod = periods?.find((period) => period.status === "open");
  const label = selected
    ? periodLabel(selected.startDate, selected.endDate)
    : "Нет периода";

  useEffect(() => {
    if (!openPeriod) {
      return;
    }
    setStoreTotalRub(String(openPeriod.storeTotalRub));
    setRate(String(openPeriod.rate));
  }, [openPeriod]);

  async function onSaveWeek(event: FormEvent) {
    event.preventDefault();
    if (!token || !openPeriod) {
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await api.periods.update(token, openPeriod._id, {
        storeTotalRub: Number(storeTotalRub),
        rate: Number(rate),
      });
      refreshData();
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
    if (!window.confirm("Закрыть текущую неделю? Новые записи в неё больше не попадут.")) {
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
            <div className="h2-sub">
              Неделя с понедельника по воскресенье открывается сама. Воскресенье — день взносов.
            </div>
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
                  <span>
                    {periodLabel(period.startDate, period.endDate)}
                  </span>
                  <span
                    className={`badge ${
                      period.settledAt
                        ? "info"
                        : period.status === "open"
                          ? "ok"
                          : "warn"
                    }`}
                  >
                    {period.settledAt
                      ? "оплачен"
                      : period.status === "open"
                        ? "открыт"
                        : "не оплачен"}
                  </span>
                </button>
              ))
            )}

            {openPeriod ? (
              <button className="btn-secondary" disabled={busy} onClick={() => void onClose()}>
                Закрыть текущую неделю
              </button>
            ) : (
              <div className="empty" style={{ textAlign: "left" }}>
                Текущая неделя закрыта. Следующая откроется в понедельник.
              </div>
            )}

            {openPeriod ? (
              <form onSubmit={(event) => void onSaveWeek(event)} style={{ marginTop: 18 }}>
                <h2>Эта неделя</h2>
                <div className="h2-sub">
                  Даты не трогаем — только сумма магазина и ставка. Они копируются на следующую неделю.
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
                <button className="btn-primary" disabled={busy}>
                  Сохранить
                </button>
              </form>
            ) : error ? (
              <div className="err">{error}</div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
