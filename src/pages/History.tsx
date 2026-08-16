import { useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { dayName, errorMessage, fmtShort } from "../lib/format";
import { useApiQuery } from "../lib/useApi";
import { useSession } from "../session";

type Props = {
  periodId: string;
  periodOpen: boolean;
};

export function HistoryPage({ periodId, periodOpen }: Props) {
  const { token, refreshData } = useSession();
  const { data: rows } = useApiQuery(
    Boolean(token),
    () => api.history(token ?? "", periodId),
    [token, periodId],
  );
  const { data: collectors } = useApiQuery(
    Boolean(token),
    () => api.collectors.list(token ?? ""),
    [token],
  );

  const [showForm, setShowForm] = useState(false);
  const [collectorId, setCollectorId] = useState("");
  const [creditedBy, setCreditedBy] = useState("");
  const [date, setDate] = useState("");
  const [kg, setKg] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onAdd(event: FormEvent) {
    event.preventDefault();
    if (!token) {
      return;
    }
    if (!collectorId) {
      setError("Выберите участника");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const body = {
        periodId,
        collectorId,
        date,
        kg: Number(kg),
        note: note.trim() || undefined,
      };
      if (creditedBy && creditedBy !== collectorId) {
        await api.entries.createCredit(token, {
          ...body,
          creditedByCollectorId: creditedBy,
        });
      } else {
        await api.entries.createManual(token, body);
      }
      refreshData();
      setKg("");
      setNote("");
      setCreditedBy("");
      setShowForm(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="page-title">История</h1>
      <div className="page-sub">Все подтверждённые записи текущего периода</div>
      <div className="card">
        {rows === undefined ? (
          <div className="loading">Загрузка…</div>
        ) : rows.length === 0 ? (
          <div className="empty">Подтверждённых записей пока нет</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Дата</th>
                <th>Участник</th>
                <th>Кг</th>
                <th>Источник</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row._id}>
                  <td>
                    {fmtShort(row.date)}{" "}
                    <span style={{ color: "#8b8b8b" }}>· {dayName(row.date)}</span>
                  </td>
                  <td>
                    {row.collectorName}
                    {row.creditedByName ? (
                      <div className="hist-credit">засчитано от {row.creditedByName}</div>
                    ) : null}
                    {row.note ? <div className="hist-note">«{row.note}»</div> : null}
                  </td>
                  <td>{row.kg} кг</td>
                  <td>
                    <span className={`badge ${row.source === "invoice" ? "ok" : "info"}`}>
                      {row.source === "invoice" ? "накладная" : "вручную"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {periodOpen ? (
        showForm ? (
          <form className="card" onSubmit={(event) => void onAdd(event)}>
            <h2>Добавить запись вручную</h2>
            <div className="h2-sub">Если накладной не было или нужно засчитать чужой забор</div>
            <div className="grid2">
              <div className="field">
                <label htmlFor="hWho">Участник</label>
                <select
                  id="hWho"
                  value={collectorId}
                  onChange={(event) => setCollectorId(event.target.value)}
                  required
                >
                  <option value="">выберите</option>
                  {collectors?.map((collector) => (
                    <option value={collector._id} key={collector._id}>
                      {collector.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="hDate">Дата</label>
                <input
                  id="hDate"
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                  required
                />
              </div>
            </div>
            <div className="grid2">
              <div className="field">
                <label htmlFor="hKg">Кг</label>
                <input
                  id="hKg"
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={kg}
                  onChange={(event) => setKg(event.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="hCredit">Засчитано от</label>
                <select
                  id="hCredit"
                  value={creditedBy}
                  onChange={(event) => setCreditedBy(event.target.value)}
                >
                  <option value="">нет — сам забирал</option>
                  {collectors
                    ?.filter((collector) => collector._id !== collectorId)
                    .map((collector) => (
                      <option value={collector._id} key={collector._id}>
                        {collector.name}
                      </option>
                    ))}
                </select>
              </div>
            </div>
            <div className="field">
              <label htmlFor="hNote">Заметка</label>
              <input
                id="hNote"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="необязательно"
              />
            </div>
            {error ? <div className="err">{error}</div> : null}
            <button className="btn-primary" disabled={busy}>
              Добавить
            </button>
          </form>
        ) : (
          <button type="button" className="btn-secondary" onClick={() => setShowForm(true)}>
            + Запись вручную
          </button>
        )
      ) : null}
    </>
  );
}
