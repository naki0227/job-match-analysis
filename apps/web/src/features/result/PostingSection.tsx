import type { JobSectionOverview } from "@job-match/contracts";

type Props = {
  id: string;
  title: string;
  section: JobSectionOverview | undefined;
};

type Group = { label: string | null; texts: string[] };

/** Consecutive quotes under the same page heading are shown together. */
function groupByHeading(
  quotes: Extract<JobSectionOverview, { status: "known" }>["quotes"],
): Group[] {
  const groups: Group[] = [];
  for (const quote of quotes) {
    const last = groups.at(-1);
    if (last && last.label === quote.section) last.texts.push(quote.text);
    else groups.push({ label: quote.section, texts: [quote.text] });
  }
  return groups;
}

/**
 * One part of the posting in its own words (duties, work style, the people
 * it asks for). Quotes are shown as written; nothing is summarized.
 */
export function PostingSection({ id, title, section }: Props) {
  const headingId = `${id}-heading`;
  return (
    <section className="posting-section" aria-labelledby={headingId}>
      <h3 id={headingId}>{title}</h3>
      {section?.status === "known" ? (
        groupByHeading(section.quotes).map((group, index) => (
          <div className="posting-group" key={`${group.label}-${index}`}>
            {group.label && <h4>{group.label}</h4>}
            <ul>
              {group.texts.map((text, textIndex) => (
                <li key={textIndex}>{text}</li>
              ))}
            </ul>
          </div>
        ))
      ) : (
        <p className="meta">求人ページから確認できず</p>
      )}
    </section>
  );
}
