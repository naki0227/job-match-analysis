import { useState, type FormEvent } from "react";

type Props = {
  busy: boolean;
  invalid: boolean;
  onSubmit: (url: string) => void;
  initialUrl?: string;
};

export function AnalyzeForm({
  busy,
  invalid,
  onSubmit,
  initialUrl = "",
}: Props) {
  const [url, setUrl] = useState(initialUrl);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!busy) onSubmit(url);
  }

  return (
    <form className="panel analyze-form" onSubmit={handleSubmit} noValidate>
      <label className="visually-hidden" htmlFor="job-url">
        求人ページのURL
      </label>
      <div className="url-row">
        <input
          id="job-url"
          className="input"
          type="url"
          inputMode="url"
          autoComplete="url"
          placeholder="https:// から始まる求人URLを貼り付ける"
          value={url}
          aria-invalid={invalid}
          aria-describedby={invalid ? "job-url-error" : undefined}
          onChange={(event) => setUrl(event.target.value)}
        />
        <button className="primary" type="submit" disabled={busy}>
          {busy ? "送信中…" : "分析する"}
        </button>
      </div>
      {invalid && (
        <p id="job-url-error" className="field-error" role="alert">
          https:// で始まる公開求人ページのURLを入力してください。
        </p>
      )}
    </form>
  );
}
