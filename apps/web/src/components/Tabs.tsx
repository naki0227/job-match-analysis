import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";

export type TabItem<K extends string> = { key: K; label: string };

type Props<K extends string> = {
  label: string;
  tabs: readonly TabItem<K>[];
  selected: K;
  onSelect: (key: K) => void;
  children: ReactNode;
};

/** WAI-ARIA tabs with arrow/Home/End keys and one visible panel. */
export function Tabs<K extends string>({
  label,
  tabs,
  selected,
  onSelect,
  children,
}: Props<K>) {
  const base = useId();
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const index = tabs.findIndex((tab) => tab.key === selected);

  function move(event: KeyboardEvent<HTMLDivElement>) {
    const last = tabs.length - 1;
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % tabs.length
        : event.key === "ArrowLeft"
          ? (index - 1 + tabs.length) % tabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    const tab = tabs[next];
    if (!tab) return;
    onSelect(tab.key);
    buttons.current[next]?.focus();
  }

  return (
    <>
      <div className="tabs" role="tablist" aria-label={label} onKeyDown={move}>
        {tabs.map((tab, position) => (
          <button
            key={tab.key}
            ref={(element) => {
              buttons.current[position] = element;
            }}
            id={`${base}-tab-${tab.key}`}
            className="tab"
            type="button"
            role="tab"
            aria-selected={tab.key === selected}
            aria-controls={`${base}-panel`}
            tabIndex={tab.key === selected ? 0 : -1}
            onClick={() => onSelect(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div
        id={`${base}-panel`}
        className="tab-panel"
        role="tabpanel"
        aria-labelledby={`${base}-tab-${selected}`}
      >
        {children}
      </div>
    </>
  );
}
