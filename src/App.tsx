import { Component, useEffect, useState, type ReactNode } from "react";
import { Shell, type SectionId } from "./components/Shell";
import { api } from "./lib/api";
import { errorMessage } from "./lib/format";
import { ApiError } from "./lib/http";
import { useApiQuery } from "./lib/useApi";
import { CalendarPage } from "./pages/Calendar";
import { HistoryPage } from "./pages/History";
import { HomePage } from "./pages/Home";
import { LoginPage } from "./pages/Login";
import { MiniAppPage } from "./pages/MiniApp";
import { ParticipantsPage } from "./pages/Participants";
import { SettingsPage } from "./pages/Settings";
import { TelegramPage } from "./pages/Telegram";
import { useSession } from "./session";
import { getTelegramWebApp } from "./lib/telegram";

export function App() {
  if (getTelegramWebApp()) {
    return <MiniAppPage />;
  }
  return <SessionGate />;
}

function SessionGate() {
  const { token, setToken } = useSession();
  if (!token) {
    return <LoginPage />;
  }
  return (
    <QueryErrorBoundary resetKey={token} onAuthError={() => setToken(null)}>
      <AuthedApp />
    </QueryErrorBoundary>
  );
}

function AuthedApp() {
  const { token, setToken } = useSession();
  const { data: me, error: meError } = useApiQuery(
    Boolean(token),
    () => api.me(token ?? ""),
    [token],
  );
  const { data: periods } = useApiQuery(
    Boolean(token),
    () => api.periods.list(token ?? ""),
    [token],
  );

  const [section, setSection] = useState<SectionId>("home");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [periodId, setPeriodId] = useState<string | null>(null);

  useEffect(() => {
    if (!periods) {
      return;
    }
    if (periodId && periods.some((period) => period._id === periodId)) {
      return;
    }
    const open = periods.find((period) => period.status === "open");
    const next = open ?? periods[0];
    setPeriodId(next?._id ?? null);
  }, [periods, periodId]);

  async function onLogout() {
    try {
      if (token) {
        await api.logout(token);
      }
    } catch {
      // Session may already be gone.
    }
    setToken(null);
  }

  if (meError instanceof ApiError && meError.status === 401) {
    return <div className="loading" style={{ padding: 32 }}>Сессия истекла…</div>;
  }

  if (me === undefined || periods === undefined) {
    return <div className="loading" style={{ padding: 32 }}>Загрузка…</div>;
  }

  const selected = periods.find((period) => period._id === periodId) ?? null;

  return (
    <Shell
      section={section}
      onSection={setSection}
      sidebarOpen={sidebarOpen}
      onSidebar={setSidebarOpen}
      periodId={periodId}
      onPeriod={setPeriodId}
      onLogout={() => void onLogout()}
    >
      {!periodId && section !== "settings" && section !== "participants" && section !== "telegram" ? (
        <div className="card">
          <h2>Нет периода</h2>
          <div className="h2-sub" style={{ marginBottom: 0 }}>
            Текущая неделя закрыта. Следующая откроется в понедельник.
          </div>
        </div>
      ) : null}
      {section === "home" && periodId ? <HomePage periodId={periodId} /> : null}
      {section === "calendar" && periodId ? <CalendarPage periodId={periodId} /> : null}
      {section === "participants" ? <ParticipantsPage /> : null}
      {section === "history" && periodId ? (
        <HistoryPage periodId={periodId} periodOpen={selected?.status === "open"} />
      ) : null}
      {section === "telegram" ? <TelegramPage /> : null}
      {section === "settings" ? <SettingsPage /> : null}
    </Shell>
  );
}

type BoundaryProps = {
  resetKey: string;
  onAuthError: () => void;
  children: ReactNode;
};

type BoundaryState = { message: string | null };

class QueryErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { message: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { message: error.message };
  }

  componentDidCatch(error: Error) {
    if (error.message === "Not authenticated" || error.message === "Session expired") {
      this.props.onAuthError();
    }
  }

  componentDidUpdate(prevProps: BoundaryProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.message) {
      this.setState({ message: null });
    }
  }

  render() {
    if (this.state.message === "Not authenticated" || this.state.message === "Session expired") {
      return <div className="loading" style={{ padding: 32 }}>Сессия истекла…</div>;
    }
    if (this.state.message) {
      return (
        <div className="login-wrap">
          <div className="login-card">
            <h1>Ошибка</h1>
            <div className="sub">{errorMessage(this.state.message)}</div>
            <button className="btn-primary" onClick={this.props.onAuthError}>
              На экран входа
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
