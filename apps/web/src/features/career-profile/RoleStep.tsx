import { useState } from "react";
import { MAX_ROLE_LENGTH, roleCategories } from "./role-catalog";

type Props = {
  roles: string[];
  onChange: (roles: string[]) => void;
};

/**
 * Target roles for any occupation: browse a broad category for examples, or
 * type the role in your own words. Only the role names are saved.
 */
export function RoleStep({ roles, onChange }: Props) {
  const [custom, setCustom] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const examples =
    roleCategories.find((item) => item.name === category)?.examples ?? [];

  function toggle(role: string) {
    onChange(
      roles.includes(role)
        ? roles.filter((current) => current !== role)
        : [...roles, role],
    );
  }

  function addCustom() {
    const role = custom.trim().slice(0, MAX_ROLE_LENGTH);
    if (role && !roles.includes(role)) onChange([...roles, role]);
    setCustom("");
  }

  return (
    <div className="wizard-step">
      <div className="eyebrow">TARGET ROLE</div>
      <h1 className="question">どんな仕事を見てる？</h1>
      <p className="sub">
        職種名を入力するか、分類から選べます。複数選べて、あとから変更できます。
      </p>
      <div className="url-row role-custom">
        <label className="visually-hidden" htmlFor="custom-role">
          職種名
        </label>
        <input
          id="custom-role"
          className="input"
          type="text"
          maxLength={MAX_ROLE_LENGTH}
          placeholder="例: 法人営業、採用担当、介護士"
          value={custom}
          onChange={(event) => setCustom(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addCustom();
            }
          }}
        />
        <button className="secondary" type="button" onClick={addCustom}>
          追加
        </button>
      </div>
      {roles.length > 0 && (
        <div className="role-options" role="group" aria-label="選んだ職種">
          {roles.map((role) => (
            <button
              key={role}
              className="chip"
              type="button"
              aria-pressed="true"
              title="押すと外します"
              onClick={() => toggle(role)}
            >
              {role}
            </button>
          ))}
        </div>
      )}
      <div className="role-options" role="group" aria-label="職種の分類">
        {roleCategories.map((item) => (
          <button
            key={item.name}
            className="chip"
            type="button"
            aria-pressed={category === item.name}
            onClick={() =>
              setCategory((current) =>
                current === item.name ? null : item.name,
              )
            }
          >
            {item.name}
          </button>
        ))}
      </div>
      {category && (
        <div
          className="role-options"
          role="group"
          aria-label={`${category}の職種の例`}
        >
          {examples.map((role) => (
            <button
              key={role}
              className="chip"
              type="button"
              aria-pressed={roles.includes(role)}
              onClick={() => toggle(role)}
            >
              {role}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
