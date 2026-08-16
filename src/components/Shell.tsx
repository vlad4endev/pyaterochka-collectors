import type { ReactNode } from "react";
import { PeriodPicker } from "./PeriodPicker";
import {
  IconCalendar,
  IconHistory,
  IconHome,
  IconSettings,
  IconUsers,
} from "./Icons";

export type SectionId = "home" | "calendar" | "participants" | "history" | "settings";

const NAV: Array<{
  id: SectionId;
  label: string;
  icon: ReactNode;
}> = [
  { id: "home", label: "Главная", icon: <IconHome /> },
  { id: "calendar", label: "Календарь", icon: <IconCalendar /> },
  { id: "participants", label: "Участники", icon: <IconUsers /> },
  { id: "history", label: "История", icon: <IconHistory /> },
  { id: "settings", label: "Настройки", icon: <IconSettings /> },
];

type Props = {
  section: SectionId;
  onSection: (id: SectionId) => void;
  sidebarOpen: boolean;
  onSidebar: (open: boolean) => void;
  periodId: string | null;
  onPeriod: (id: string) => void;
  onLogout: () => void;
  children: ReactNode;
};

export function Shell({
  section,
  onSection,
  sidebarOpen,
  onSidebar,
  periodId,
  onPeriod,
  onLogout,
  children,
}: Props) {
  return (
    <div className="shell">
      <div className="mobile-bar">
        <button type="button" className="burger" onClick={() => onSidebar(!sidebarOpen)}>
          ☰
        </button>
        <strong>Админка</strong>
      </div>
      {sidebarOpen ? (
        <div className="sidebar-backdrop" onClick={() => onSidebar(false)} />
      ) : null}
      <aside className={`sidebar${sidebarOpen ? " open" : ""}`}>
        <div className="brand">
          <div className="t">Админка сборщиков</div>
          <div className="s">Пятёрка на бульваре</div>
        </div>
        <nav className="nav">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`nav-item${section === item.id ? " active" : ""}`}
              onClick={() => {
                onSection(item.id);
                onSidebar(false);
              }}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          Работает отдельно от бота — отдельный вход по паролю.
          <button type="button" className="logout" onClick={onLogout}>
            Выйти
          </button>
        </div>
      </aside>
      <main className="main">
        <PeriodPicker selectedId={periodId} onSelect={onPeriod} />
        {children}
      </main>
    </div>
  );
}
