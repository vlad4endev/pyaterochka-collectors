import { useState, type FormEvent } from "react";
import { PageHeader } from "../components/PageHeader";
import { api, type HistoryRow } from "../lib/api";
import { dayName, errorMessage, fmtShort, parseKg } from "../lib/format";
import { useApiQuery } from "../lib/useApi";
import { useSession } from "../session";

type Props = {
  periodId: string;
  canEdit: boolean;
  startDate: string;
  endDate: string;
};

function payeeId(row: HistoryRow): string {
  return row.creditedByCollectorId ?? row.collectorId;
}

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

  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [collectorId, setCollectorId] = useState("");
  const [creditedBy, setCreditedBy] = useState("");
  const [date, setDate] = useState("");
  const [kg, setKg] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function resetForm() {
    setEditingId(null);
    setShowForm(false);
    setCollectorId("");
    setCreditedBy("");
    setKg("");
    setNote("");
    setError(null);
  }

  function openAdd() {
    setEditingId(null);
    setCollectorId("");
    setCreditedBy("");
    setKg("");
    setNote("");
    setError(null);
    if (!date) {
      setDate(startDate);
    }
    setShowForm(true);
  }

  function openEdit(row: HistoryRow) {
    setEditingId(row._id);
    setCollectorId(payeeId(row));
    setCreditedBy(row.creditedByCollectorId ? row.collectorId : "");
    setDate(row.date);
    setKg(row.kg != null ? String(row.kg) : "");
    setNote(row.note ?? "");
    setError(null);
    setShowForm(true);
  }

  async function onSave(event: FormEvent) {
    event.preventDefault();
    if (!token) {
      return;
    }
    if (!collectorId) {
      setError("Выберите участника");
      return;
    }
    const kgValue = parseKg(kg);
    const editing = rows?.find((row) => row._id === editingId);
    if (kgValue === undefined && editing?.status !== "skipped") {
      setError("Укажите кг больше нуля");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const credit =
        creditedBy && creditedBy !== collectorId
          ? { collectorId: creditedBy, creditedByCollectorId: collectorId }
          : { collectorId, creditedByCollectorId: null };
      if (editingId) {
        await api.entries.update(token, editingId, {
          ...credit,
          date,
          ...(kgValue !== undefined ? { kg: kgValue } : {}),
          note: note.trim() || null,
        });
      } else if (kgValue === undefined) {
        setError("Укажите кг больше нуля");
        return;
      } else if (creditedBy && creditedBy !== collectorId) {
        await api.entries.createCredit(token, {
          periodId,
          collectorId: creditedBy,
          creditedByCollectorId: collectorId,
          date,
          kg: kgValue,
          note: note.trim() || undefined,
        });
      } else {
        await api.entries.createManual(token, {
          periodId,
          collectorId,
          date,
          kg: kgValue,
          note: note.trim() || undefined,
        });
      }
      refreshData();
      resetForm();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(row: HistoryRow) {
    if (!token) {
      return;
    }
    const who = row.creditedByName ?? row.collectorName;
    const label = row.status === "skipped" ? "не брал" : `${row.kg} кг`;
    if (!window.confirm(`Удалить запись ${fmtShort(row.date)} · ${who} · ${label}?`)) {
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await api.entries.remove(token, row._id);
      if (editingId === row._id) {
        resetForm();
      }
      refreshData();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const editing = Boolean(editingId);

  return (
    <>
      <PageHeader
        title="История"
        sub="Подтверждённые кг недели. Если расчёт не сходится — поправьте запись или добавьте недостающие."
        actions={
          canEdit && !showForm ? (
            <button type="button" className="btn-primary" onClick={openAdd}>
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
                  {canEdit ? <th></th> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row._id} className={editingId === row._id ? "hist-editing" : undefined}>
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
                    <td>{row.status === "skipped" ? "—" : `${row.kg} кг`}</td>
                    <td>
                      <span
                        className={`badge ${
                          row.status === "skipped"
                            ? "warn"
                            : row.source === "invoice"
                              ? "ok"
                              : "info"
                        }`}
                      >
                        {row.status === "skipped"
                          ? "не брал"
                          : row.source === "invoice"
                            ? "накладная"
                            : "вручную"}
                      </span>
                    </td>
                    {canEdit ? (
                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="btn-quiet"
                            disabled={busy}
                            onClick={() => openEdit(row)}
                          >
                            Изменить
                          </button>
                          <button
                            type="button"
                            className="btn-quiet danger"
                            disabled={busy}
                            onClick={() => void onDelete(row)}
                          >
                            Удалить
                          </button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {canEdit && showForm ? (
        <form className="card" onSubmit={(event) => void onSave(event)}>
          <h2>{editing ? "Изменить запись" : "Добавить запись вручную"}</h2>
          <div className="h2-sub">
            {editing
              ? "Кг сразу попадают в расчёт недели, пока участник ещё не оплатил."
              : "Если кто-то забрал чужой день — кг и сумма идут ему, а в календаре закрывается день того, за кого взяли. Можно править и прошлые недели, пока по ним не закрыта оплата."}
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
                required={!editing || rows?.find((row) => row._id === editingId)?.status !== "skipped"}
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
              {editing ? "Сохранить" : "Добавить"}
            </button>
            <button type="button" className="btn-ghost" onClick={resetForm}>
              Отмена
            </button>
          </div>
        </form>
      ) : error && !showForm ? (
        <div className="err" style={{ marginTop: 12 }}>
          {error}
        </div>
      ) : null}
    </>
  );
}
