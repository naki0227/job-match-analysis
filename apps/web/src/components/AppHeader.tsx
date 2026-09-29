export type Screen =
  | "home"
  | "analyze"
  | "history"
  | "match"
  | "insights"
  | "settings"
  | "profile";

const items: ReadonlyArray<readonly [Screen, string]> = [
  ["home", "ホーム"],
  ["analyze", "求人分析"],
  ["history", "分析履歴"],
  ["insights", "インサイト"],
];

type Props = {
  current: Screen;
  onNavigate: (screen: Screen) => void;
  /** Shown on the settings button, e.g. the first letter of the email. */
  initial: string;
};

export function AppHeader({ current, onNavigate, initial }: Props) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="brand-row">
          <button
            className="brand"
            type="button"
            onClick={() => onNavigate("home")}
          >
            <span className="brand-mark" aria-hidden="true" />
            <span>job match</span>
          </button>
          <button
            className="avatar"
            type="button"
            aria-label="設定"
            aria-current={current === "settings" ? "page" : undefined}
            onClick={() => onNavigate("settings")}
          >
            {initial}
          </button>
        </div>
        <nav className="nav" aria-label="メインナビゲーション">
          {items.map(([screen, label]) => (
            <button
              key={screen}
              type="button"
              aria-current={
                current === screen ||
                (current === "match" && screen === "history")
                  ? "page"
                  : undefined
              }
              onClick={() => onNavigate(screen)}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>
    </header>
  );
}
