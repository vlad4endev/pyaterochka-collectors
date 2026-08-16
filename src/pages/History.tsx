import { useState, type FormEvent } from "react";
import { PageHeader } from "../components/PageHeader";
import { api } from "../lib/api";
import { dayName, errorMessage, fmtShort } from "../lib/format";
import { useApiQuery } from "../lib/useApi";
import { useSession } from "../session";

type Props = {
  periodId: string;
  canEdit: boolean;
  startDate: string;
  endDate: string;
};

export function HistoryPage({ periodId, canEdit, startDate, endDate }: Props) {
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
          periodId,
          collectorId: creditedBy,
          creditedByCollectorId: collectorId,
          date,
          kg: Number(kg),
          note: note.trim() || undefined,
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
      <PageHeader
        title="История"
        sub="Все подтверждённые записи выбранной недели"
        actions={
          canEdit && !showForm ? (
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                if (!date) {
                  setDate(startDate);
                }
                setShowForm(true);
              }}
            >
              Запись вручную
            </button>
          ) : undefined
        }
      />
      <div className="card">
        {rows === undefined ? (
          <div className="loading">Загрузка…</div>
        ) : rows.length === 0 ? (
          <div className="empty">Подтверждённых записей пока нет</div>
        ) : (
          <div className="table-wrap">
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
                      <span style={{ color: "var(--muted)" }}>· {dayName(row.date)}</span>
                    </td>
                    <td>
                      {row.creditedByName ?? row.collectorName}
                      {row.creditedByName ? (
                        <div className="hist-credit">день {row.collectorName}</div>
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
          </div>
        )}
      </div>

      {canEdit ? (
        showForm ? (
          <form className="card" onSubmit={(event) => void onAdd(event)}>
            <h2>Добавить запись вручную</h2>
            <div className="h2-sub">
              Если кто-то забрал чужой день — кг и сумма идут ему, а в календаре закрывается день
              того, за кого взяли. Можно править и прошлые недели, пока по ним не закрыта оплата.
            </div>
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
                  min={startDate}
                  max={endDate}
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
                <label htmlFor="hCredit">За кого взял</label>
                <select
                  id="hCredit"
                  value={creditedBy}
                  onChange={(event) => setCreditedBy(event.target.value)}
                >
                  <option value="">нет — свой день</option>
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
            <div className="msg-actions">
              <button className="btn-primary" disabled={busy}>
                Добавить
              </button>
              <button type="button" className="btn-ghost" onClick={() => setShowForm(false)}>
                Отмена
              </button>
            </div>
          </form>
        ) : null
      ) : null}
    </>
  );
}
