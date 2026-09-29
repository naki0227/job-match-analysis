export type Screen = "home" | "analyze" | "history" | "match" | "profile";

const items: ReadonlyArray<readonly [Screen, string]> = [
  ["home", "ホーム"],
  ["analyze", "求人分析"],
  ["history", "分析履歴"],
  ["profile", "希望条件"],
];

type Props = {
  current: Screen;
  onNavigate: (screen: Screen) => void;
};

export function AppHeader({ current, onNavigate }: Props) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <button
          className="brand"
          type="button"
          onClick={() => onNavigate("home")}
        >
          <span className="brand-mark" aria-hidden="true" />
          <span>job match</span>
        </button>
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
