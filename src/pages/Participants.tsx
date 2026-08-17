import { useState, type FormEvent } from "react";
import { PageHeader } from "../components/PageHeader";
import { api } from "../lib/api";
import { DAY_NAMES, errorMessage } from "../lib/format";
import { useApiQuery } from "../lib/useApi";
import { useSession } from "../session";

export function ParticipantsPage() {
  const { token, refreshData } = useSession();
  const { data: collectors } = useApiQuery(
    Boolean(token),
    () => api.collectors.list(token ?? ""),
    [token],
  );

  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [dayOfWeek, setDayOfWeek] = useState("");
  const [telegramUserId, setTelegramUserId] = useState("");
  const [maxUserId, setMaxUserId] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);

  async function patch(
    collectorId: string,
    fields: {
      name?: string;
      dayOfWeek?: number | null;
      phone?: string;
      telegramUserId?: string;
      maxUserId?: string;
      active?: boolean;
    },
  ) {
    if (!token) {
      return;
    }
    setError(null);
    try {
      await api.collectors.update(token, collectorId, fields);
      refreshData();
      if (fields.maxUserId !== undefined) {
        setToast(
          fields.maxUserId
            ? "MAX ID сохранён — бот узнает участника"
            : "MAX ID снят",
        );
      }
      if (fields.phone !== undefined) {
        setToast(fields.phone ? "Телефон сохранён" : "Телефон снят");
      }
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function onAdd(event: FormEvent) {
    event.preventDefault();
    if (!token) {
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await api.collectors.create(token, {
        name,
        dayOfWeek: dayOfWeek === "" ? null : Number(dayOfWeek),
        telegramUserId: telegramUserId.trim() || undefined,
        maxUserId: maxUserId.trim() || undefined,
        phone: phone.trim() || undefined,
      });
      refreshData();
      setName("");
      setDayOfWeek("");
      setTelegramUserId("");
      setMaxUserId("");
      setPhone("");
      setShowAdd(false);
      setToast("Участник добавлен");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Участники"
        sub="Телефон с бота связывает Telegram и MAX: кто поделился номером в одном мессенджере, в другом подтянется автоматически. ID тоже можно править вручную."
        actions={
          showAdd ? undefined : (
            <button type="button" className="btn-primary" onClick={() => setShowAdd(true)}>
              Добавить
            </button>
          )
        }
      />
      <div className="card">
        {collectors === undefined ? (
          <div className="loading">Загрузка…</div>
        ) : collectors.length === 0 ? (
          <div className="empty">Участников пока нет</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Имя</th>
                  <th className="id-col">Телефон</th>
                  <th>День</th>
                  <th className="id-col">Telegram ID</th>
                  <th className="id-col">MAX ID</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {collectors.map((collector) => (
                  <tr key={collector._id}>
                    <td>
                      <input
                        defaultValue={collector.name}
                        onBlur={(event) => {
                          const next = event.target.value.trim();
                          if (next && next !== collector.name) {
                            void patch(collector._id, { name: next });
                          }
                        }}
                      />
                    </td>
                    <td className="id-col">
                      <input
                        key={`${collector._id}-phone-${collector.phone ?? ""}`}
                        defaultValue={collector.phone ?? ""}
                        placeholder="с бота"
                        inputMode="tel"
                        onBlur={(event) => {
                          const next = event.target.value.trim();
                          if (next !== (collector.phone ?? "")) {
                            void patch(collector._id, { phone: next });
                          }
                        }}
                      />
                    </td>
                    <td>
                      <select
                        value={collector.dayOfWeek === null ? "" : String(collector.dayOfWeek)}
                        onChange={(event) => {
                          const value = event.target.value;
                          void patch(collector._id, {
                            dayOfWeek: value === "" ? null : Number(value),
                          });
                        }}
                      >
                        <option value="">—</option>
                        {DAY_NAMES.map((label, index) => (
                          <option value={index} key={label}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="id-col">
                      <input
                        key={`${collector._id}-tg-${collector.telegramUserId ?? ""}`}
                        defaultValue={collector.telegramUserId ?? ""}
                        placeholder="из Telegram-бота"
                        inputMode="numeric"
                        onBlur={(event) => {
                          const next = event.target.value.trim();
                          if (next !== (collector.telegramUserId ?? "")) {
                            void patch(collector._id, { telegramUserId: next });
                          }
                        }}
                      />
                    </td>
                    <td className="id-col">
                      <input
                        key={`${collector._id}-max-${collector.maxUserId ?? ""}`}
                        defaultValue={collector.maxUserId ?? ""}
                        placeholder="из MAX-бота"
                        inputMode="numeric"
                        onBlur={(event) => {
                          const next = event.target.value.trim();
                          if (next !== (collector.maxUserId ?? "")) {
                            void patch(collector._id, { maxUserId: next });
                          }
                        }}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className={`toggle-pill ${collector.active ? "on" : "off"}`}
                        onClick={() => void patch(collector._id, { active: !collector.active })}
                      >
                        {collector.active ? "активен" : "скрыт"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {showAdd ? (
        <form className="card" onSubmit={(event) => void onAdd(event)}>
          <h2>Новый участник</h2>
          <div className="field">
            <label htmlFor="cName">Имя</label>
            <input
              id="cName"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </div>
          <div className="grid2">
            <div className="field">
              <label htmlFor="cDay">День недели</label>
              <select
                id="cDay"
                value={dayOfWeek}
                onChange={(event) => setDayOfWeek(event.target.value)}
              >
                <option value="">без графика</option>
                {DAY_NAMES.map((label, index) => (
                  <option value={index} key={label}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="cPhone">Телефон</label>
              <input
                id="cPhone"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="+7…"
                inputMode="tel"
              />
            </div>
          </div>
          <div className="grid2">
            <div className="field">
              <label htmlFor="cTg">Telegram ID</label>
              <input
                id="cTg"
                value={telegramUserId}
                onChange={(event) => setTelegramUserId(event.target.value)}
                placeholder="из Telegram-бота"
                inputMode="numeric"
              />
            </div>
            <div className="field">
              <label htmlFor="cMax">MAX ID</label>
              <input
                id="cMax"
                value={maxUserId}
                onChange={(event) => setMaxUserId(event.target.value)}
                placeholder="после /start в MAX-боте"
                inputMode="numeric"
              />
            </div>
          </div>
          <div className="msg-actions">
            <button className="btn-primary" disabled={busy || name.trim().length < 1}>
              Сохранить
            </button>
            <button type="button" className="btn-ghost" onClick={() => setShowAdd(false)}>
              Отмена
            </button>
          </div>
        </form>
      ) : null}
      {error ? <div className="err">{error}</div> : null}
      {toast ? <div className="toast">{toast}</div> : null}
    </>
  );
}
