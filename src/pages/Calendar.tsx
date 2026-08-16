import { api } from "../lib/api";
import { dayNumber, initials, mondayPad } from "../lib/format";
import { useApiQuery } from "../lib/useApi";
import { useSession } from "../session";

const DOWS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

type Props = {
  periodId: string;
};

export function CalendarPage({ periodId }: Props) {
  const { token } = useSession();
  const { data: dashboard } = useApiQuery(
    Boolean(token),
    () => api.dashboard(token ?? "", periodId),
    [token, periodId],
  );

  if (dashboard === undefined) {
    return <div className="loading">Загрузка…</div>;
  }

  const pad = dashboard.calendar[0]
    ? mondayPad(dashboard.calendar[0].weekday)
    : 0;

  return (
    <>
      <h1 className="page-title">Календарь</h1>
      <div className="page-sub">
        Кто по графику, где пропуск, где ждёт проверки — на весь период сразу
      </div>
      <div className="card">
        <div className="cal-grid">
          {DOWS.map((label) => (
            <div className="cal-dow" key={label}>
              {label}
            </div>
          ))}
          {Array.from({ length: pad }, (_, index) => (
            <div className="cal-cell pad" key={`pad-${index}`} />
          ))}
          {dashboard.calendar.map((day) => (
            <div className={`cal-cell ${day.status}`} key={day.date}>
              <div className="num">{dayNumber(day.date)}</div>
              {day.people.length > 0 ? (
                <div className="who">
                  {day.people.map((person) => initials(person.name)).join(", ")}
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <div className="cal-legend">
          <span>
            <span className="dot" style={{ background: "#a8dcb9" }} />
            есть запись
          </span>
          <span>
            <span className="dot" style={{ background: "#f3d78a" }} />
            на проверке
          </span>
          <span>
            <span className="dot" style={{ background: "#eeb3b3" }} />
            пропуск
          </span>
        </div>
      </div>
    </>
  );
}
