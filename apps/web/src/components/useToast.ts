import { useCallback, useEffect, useRef, useState } from "react";

/** Short-lived status message, announced politely to screen readers. */
export function useToast(durationMs = 2_000) {
  const [message, setMessage] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const notify = useCallback(
    (text: string) => {
      clearTimeout(timer.current);
      setMessage(text);
      timer.current = setTimeout(() => setMessage(""), durationMs);
    },
    [durationMs],
  );

  useEffect(() => () => clearTimeout(timer.current), []);
  return { message, notify };
}
