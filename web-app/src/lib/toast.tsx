import { createContext, useCallback, useContext, useRef, useState } from "react";

const ToastContext = createContext<(message: string) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timeoutRef = useRef<number | undefined>(undefined);

  const showToast = useCallback((msg: string) => {
    setMessage(msg);
    window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => setMessage(null), 2600);
  }, []);

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      {message && (
        <div className="animate-overlay-in fixed bottom-7 left-1/2 z-70 -translate-x-1/2 rounded-lg bg-[var(--color-ink)] px-5 py-3 text-sm font-semibold text-white shadow-[0_8px_26px_rgba(0,0,0,0.22)]">
          {message}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
