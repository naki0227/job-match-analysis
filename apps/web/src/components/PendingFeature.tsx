type Props = {
  title: string;
  /** What is missing, in user-facing words. */
  reason: string;
};

/** States plainly that a feature is not connected yet; never shows sample data. */
export function PendingFeature({ title, reason }: Props) {
  return (
    <div className="pending-feature" role="note">
      <strong>{title}</strong>
      <p className="meta">{reason}</p>
    </div>
  );
}
