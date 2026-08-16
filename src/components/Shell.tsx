import type { ReactNode } from "react";
import { PeriodPicker } from "./PeriodPicker";
import {
  IconCalendar,
  IconHistory,
  IconHome,
  IconLogout,
  IconSettings,
  IconTelegram,
  IconUsers,
} from "./Icons";

export type SectionId = "home" | "calendar" | "participants" | "history" | "telegram" | "settings";

const WEEK_NAV: Array<{ id: SectionId; label: string; icon: ReactNode }> = [
  { id: "home", label: "Главная", icon: <IconHome /> },
  { id: "calendar", label: "Календарь", icon: <IconCalendar /> },
  { id: "history", label: "История", icon: <IconHistory /> },
];

const TEAM_NAV: Array<{ id: SectionId; label: string; icon: ReactNode }> = [
  { id: "participants", label: "Участники", icon: <IconUsers /> },
  { id: "telegram", label: "Telegram", icon: <IconTelegram /> },
  { id: "settings", label: "Настройки", icon: <IconSettings /> },
];

const PERIOD_SECTIONS: SectionId[] = ["home", "calendar", "history"];

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

function NavButton({
  item,
  active,
  onPick,
}: {
  item: { id: SectionId; label: string; icon: ReactNode };
  active: boolean;
  onPick: (id: SectionId) => void;
}) {
  return (
    <button
      type="button"
      className={`nav-item${active ? " active" : ""}`}
      onClick={() => onPick(item.id)}
    >
      {item.icon}
      <span>{item.label}</span>
    </button>
  );
}

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
  const showPeriod = PERIOD_SECTIONS.includes(section);

  function pickSection(id: SectionId) {
    onSection(id);
    onSidebar(false);
  }

  return (
    <div className="shell">
      <div className="mobile-bar">
        <button type="button" className="burger" onClick={() => onSidebar(!sidebarOpen)} aria-label="Меню">
          <span />
          <span />
          <span />
        </button>
        <div className="mobile-brand">
          <span className="brand-mark">5</span>
          <strong>Админка</strong>
        </div>
      </div>
      {sidebarOpen ? (
        <div className="sidebar-backdrop" onClick={() => onSidebar(false)} />
      ) : null}
      <aside className={`sidebar${sidebarOpen ? " open" : ""}`}>
        <div className="brand">
          <span className="brand-mark">5</span>
          <div>
            <div className="t">Пятёрка</div>
            <div className="s">Админка сборщиков</div>
          </div>
        </div>
        <nav className="nav">
          <div className="nav-group">
            <div className="nav-group-label">Неделя</div>
            {WEEK_NAV.map((item) => (
              <NavButton
                key={item.id}
                item={item}
                active={section === item.id}
                onPick={pickSection}
              />
            ))}
          </div>
          <div className="nav-group">
            <div className="nav-group-label">Команда</div>
            {TEAM_NAV.map((item) => (
              <NavButton
                key={item.id}
                item={item}
                active={section === item.id}
                onPick={pickSection}
              />
            ))}
          </div>
        </nav>
        <div className="sidebar-foot">
          <button type="button" className="logout" onClick={onLogout}>
            <IconLogout />
            Выйти
          </button>
        </div>
      </aside>
      <div className="workspace">
        <div className="topbar">
          {showPeriod ? (
            <PeriodPicker selectedId={periodId} onSelect={onPeriod} />
          ) : (
            <p className="topbar-note">Общие настройки — не привязаны к неделе</p>
          )}
        </div>
        <main className="main">{children}</main>
      </div>
    </div>
  );
}
