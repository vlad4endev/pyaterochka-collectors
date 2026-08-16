import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const STORAGE_KEY = "pyaterochka.adminSession";

type SessionContextValue = {
  token: string | null;
  setToken: (token: string | null) => void;
  dataEpoch: number;
  refreshData: () => void;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() =>
    localStorage.getItem(STORAGE_KEY),
  );
  const [dataEpoch, setDataEpoch] = useState(0);

  const setToken = useCallback((next: string | null) => {
    setTokenState(next);
    if (next) {
      localStorage.setItem(STORAGE_KEY, next);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const refreshData = useCallback(() => {
    setDataEpoch((value) => value + 1);
  }, []);

  const value = useMemo(
    () => ({ token, setToken, dataEpoch, refreshData }),
    [token, setToken, dataEpoch, refreshData],
  );
  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSession must be used inside SessionProvider");
  }
  return ctx;
}
