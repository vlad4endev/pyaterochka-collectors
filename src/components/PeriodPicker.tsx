import { useEffect, useState, type FormEvent } from "react";
import { api, type Period } from "../lib/api";
import { errorMessage, periodLabel } from "../lib/format";
import { useSession } from "../session";

type Props = {
  selectedId: string | null;
  periods: Period[];
  onSelect: (id: string) => void;
};

function kindLabel(period: Period): string | null {
  if (period.kind === "current") {
    return "текущая";
  }
  if (period.kind === "previous") {
    return "прошлая";
  }
  return null;
}

export function PeriodPicker({ selectedId, periods, onSelect }: Props) {
  const { token, refreshData } = useSession();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [storeTotalRub, setStoreTotalRub] = useState("8000");
  const [rate, setRate] = useState("20");

  const selected = periods.find((period) => period._id === selectedId);
  const label = selected
    ? periodLabel(selected.startDate, selected.endDate)
    : "Нет периода";

  useEffect(() => {
    if (!selected) {
      return;
    }
    setStartDate(selected.startDate);
    setEndDate(selected.endDate);
    setStoreTotalRub(String(selected.storeTotalRub));
    setRate(String(selected.rate));
    setError(null);
  }, [selected]);

  async function onSaveWeek(event: FormEvent) {
    event.preventDefault();
    if (!token || !selected?.editable) {
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await api.periods.update(token, selected._id, {
        startDate,
        endDate,
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
    if (!selected || selected.status !== "open" || !token) {
      return;
    }
    if (!window.confirm("Закрыть текущую неделю? Новые записи в неё больше не попадут.")) {
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await api.periods.close(token, selected._id);
      refreshData();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const status = selected?.settledAt
    ? "оплачена"
    : selected?.status === "open"
      ? "открыта"
      : selected
        ? "не оплачена"
        : "";

  return (
    <>
      <button type="button" className="period-pill" onClick={() => setOpen(true)}>
        <span className="period-pill-label">{label}</span>
        {status ? <span className="period-pill-status">{status}</span> : null}
        <span className="arrow">▾</span>
      </button>
      {open ? (
        <div className="overlay" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div>
                <h2>Неделя</h2>
                <p className="h2-sub">
                  Можно править текущую и прошлую. Будущие недели не создаём и не показываем.
                </p>
              </div>
              <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
                Готово
              </button>
            </div>
            {periods.length === 0 ? (
              <div className="empty">Периодов ещё нет</div>
            ) : (
              <div className="period-list">
                {periods.map((period) => {
                  const extra = kindLabel(period);
                  return (
                    <button
                      key={period._id}
                      type="button"
                      className={`period-row${period._id === selectedId ? " active" : ""}`}
                      onClick={() => onSelect(period._id)}
                    >
                      <span>
                        {periodLabel(period.startDate, period.endDate)}
                        {extra ? (
                          <span className="period-row-kind"> · {extra}</span>
                        ) : null}
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
                          ? "оплачена"
                          : period.status === "open"
                            ? "открыта"
                            : "не оплачена"}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {selected?.editable ? (
              <form className="period-settings" onSubmit={(event) => void onSaveWeek(event)}>
                <h3>
                  {selected.kind === "previous" ? "Прошлая неделя" : "Текущая неделя"}
                </h3>
                <p className="h2-sub">
                  Даты и сумма магазина. Ставка ₽/кг меняется в Настройках — здесь только если у этой
                  недели своя цена.
                </p>
                <div className="grid2">
                  <div className="field">
                    <label htmlFor="pStart">С</label>
                    <input
                      id="pStart"
                      type="date"
                      value={startDate}
                      onChange={(event) => setStartDate(event.target.value)}
                      required
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="pEnd">По</label>
                    <input
                      id="pEnd"
                      type="date"
                      value={endDate}
                      onChange={(event) => setEndDate(event.target.value)}
                      required
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
                <div className="msg-actions">
                  <button className="btn-primary" disabled={busy}>
                    Сохранить
                  </button>
                  {selected.status === "open" ? (
                    <button
                      type="button"
                      className="btn-quiet danger"
                      disabled={busy}
                      onClick={() => void onClose()}
                    >
                      Закрыть неделю
                    </button>
                  ) : null}
                </div>
              </form>
            ) : selected ? (
              <div className="empty" style={{ textAlign: "left" }}>
                Эту неделю уже не меняем — только текущую и прошлую.
                {error ? <div className="err">{error}</div> : null}
              </div>
            ) : (
              <div className="empty" style={{ textAlign: "left" }}>
                Текущая неделя закрыта. Следующая откроется в понедельник.
                {error ? <div className="err">{error}</div> : null}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
