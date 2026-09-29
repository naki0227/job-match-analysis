import { useState } from "react";
import { suggestedRoles } from "./profile-draft";

type Props = {
  roles: string[];
  onChange: (roles: string[]) => void;
};

/** Target roles as toggle tags plus free text, as in the mock onboarding. */
export function RoleStep({ roles, onChange }: Props) {
  const [custom, setCustom] = useState("");
  const extra = roles.filter(
    (role) => !(suggestedRoles as readonly string[]).includes(role),
  );

  function toggle(role: string) {
    onChange(
      roles.includes(role)
        ? roles.filter((current) => current !== role)
        : [...roles, role],
    );
  }

  function addCustom() {
    const role = custom.trim();
    if (role && !roles.includes(role)) onChange([...roles, role]);
    setCustom("");
  }

  return (
    <div className="wizard-step">
      <div className="eyebrow">TARGET ROLE</div>
      <h1 className="question">どんな仕事を見てる？</h1>
      <p className="sub">複数選べます。あとから変更できます。</p>
      <div className="role-options" role="group" aria-label="希望職種">
        {[...suggestedRoles, ...extra].map((role) => (
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
      <div className="url-row role-custom">
        <label className="visually-hidden" htmlFor="custom-role">
          その他の職種
        </label>
        <input
          id="custom-role"
          className="input"
          type="text"
          placeholder="その他の職種"
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
    </div>
  );
}
