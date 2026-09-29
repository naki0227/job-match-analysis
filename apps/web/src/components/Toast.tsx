export function Toast({ message }: { message: string }) {
  return (
    <div
      className={message ? "toast show" : "toast"}
      role="status"
      aria-live="polite"
    >
      {message}
    </div>
  );
}
