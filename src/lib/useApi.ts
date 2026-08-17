import { useCallback, useEffect, useState } from "react";
import { ApiError } from "./http";
import { useSession } from "../session";

export function useApiQuery<T>(
  enabled: boolean,
  loader: () => Promise<T>,
  deps: ReadonlyArray<unknown>,
  options?: { refreshOnEpoch?: boolean },
) {
  const { setToken, dataEpoch } = useSession();
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((value) => value + 1), []);
  const epoch = options?.refreshOnEpoch === false ? 0 : dataEpoch;

  useEffect(() => {
    if (!enabled) {
      setData(undefined);
      setError(null);
      return;
    }
    let cancelled = false;
    loader()
      .then((value) => {
        if (!cancelled) {
          setData(value);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }
        const error = err instanceof Error ? err : new Error("Request failed");
        if (err instanceof ApiError && (err.status === 401 || error.message === "Not authenticated" || error.message === "Session expired")) {
          setToken(null);
        }
        setError(error);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, nonce, epoch, ...deps]);

  return { data, error, reload };
}
