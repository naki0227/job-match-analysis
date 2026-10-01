import type {
  EmploymentPreference,
  JobSearchRequest,
} from "@job-match/contracts";
import { useState, type FormEvent } from "react";

const employmentOptions: { value: EmploymentPreference | ""; label: string }[] =
  [
    { value: "", label: "指定しない" },
    { value: "full_time", label: "正社員・中途" },
    { value: "new_grad", label: "新卒" },
    { value: "intern", label: "インターン" },
    { value: "contract", label: "契約・業務委託" },
    { value: "part_time", label: "パート・アルバイト" },
  ];

type Props = {
  busy: boolean;
  onSearch: (request: JobSearchRequest) => void;
};

export function JobSearchForm({ busy, onSearch }: Props) {
  const [company, setCompany] = useState("");
  const [roleQuery, setRoleQuery] = useState("");
  const [employment, setEmployment] = useState<EmploymentPreference | "">("");
  const ready = company.trim() !== "" && roleQuery.trim() !== "";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !ready) return;
    onSearch({
      company: company.trim(),
      roleQuery: roleQuery.trim(),
      ...(employment ? { employmentType: employment } : {}),
    });
  }

  return (
    <form className="panel job-search-form" onSubmit={handleSubmit} noValidate>
      <label className="field-label" htmlFor="job-search-company">
        企業名
      </label>
      <input
        id="job-search-company"
        className="input"
        type="text"
        maxLength={100}
        placeholder="例: マネーフォワード"
        value={company}
        onChange={(event) => setCompany(event.target.value)}
      />
      <label className="field-label" htmlFor="job-search-role">
        職種
      </label>
      <input
        id="job-search-role"
        className="input"
        type="text"
        maxLength={100}
        placeholder="例: 法人営業、採用担当、バックエンド Go"
        value={roleQuery}
        onChange={(event) => setRoleQuery(event.target.value)}
      />
      <label className="field-label" htmlFor="job-search-employment">
        雇用形態
      </label>
      <select
        id="job-search-employment"
        className="select"
        value={employment}
        onChange={(event) =>
          setEmployment(event.target.value as EmploymentPreference | "")
        }
      >
        {employmentOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <button className="primary" type="submit" disabled={busy || !ready}>
        {busy ? "探しています…" : "求人を探す"}
      </button>
    </form>
  );
}
