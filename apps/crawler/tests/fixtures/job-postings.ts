import type { AxisTruth } from "../support/oracle-jev.js";

/**
 * Synthetic job postings across occupations and languages. `truth` lists
 * only what each posting explicitly states; every other axis must stay
 * unknown. `rules` are axes decided by explicit wording without Jev.
 */
export type PostingFixture = {
  name: string;
  html: string;
  truth: Record<string, AxisTruth>;
  rules?: Record<string, 0 | 50 | 100>;
};

const page = (job: string, company = "") =>
  `<html><body><nav>採用トップ ログイン</nav><main data-job>${job}${company}</main><footer>© Sample</footer></body></html>`;

export const occupationFixtures: PostingFixture[] = [
  {
    name: "Backend Engineer (English)",
    html: page(
      `<h1>Backend Engineer</h1>
       <p>You will work in a squad of five engineers and own features together.</p>
       <p>We work remotely; coming to the office is optional.</p>
       <p>技術スタック: Go, PostgreSQL</p>`,
      `<aside data-company><p>Our company is famous for its customer-first culture.</p></aside>`,
    ),
    truth: {
      collaboration: { choice: "100", phrases: ["squad of five"] },
      work_location: { choice: "100", phrases: ["We work remotely"] },
    },
  },
  {
    name: "法人営業（日本語）",
    html: page(
      `<h1>法人営業</h1>
       <p>既存のお客様を毎日訪問し、運用の相談に乗ります。</p>
       <p>訪問の順番や提案の組み立ては各自に任されています。</p>
       <p>原則出社です。</p>`,
    ),
    truth: {
      customer_contact: { choice: "100", phrases: ["毎日訪問"] },
      autonomy: { choice: "100", phrases: ["各自に任されて"] },
    },
    rules: { work_location: 0 },
  },
  {
    name: "Recruiter / HR (English)",
    html: page(
      `<h1>Recruiter</h1>
       <p>You will run hiring end to end: sourcing, interviews, offers and onboarding.</p>
       <p>Hiring priorities shift every few weeks as teams change their plans.</p>`,
    ),
    truth: {
      role_breadth: { choice: "100", phrases: ["end to end"] },
      work_change: { choice: "100", phrases: ["shift every few weeks"] },
    },
  },
  {
    name: "Webマーケター（日本語）",
    html: page(
      `<h1>Webマーケティング</h1>
       <p>広告運用に加えて、SEOとメール施策も一人で受け持ちます。</p>
       <p>コアタイムなしのフレックスタイム制です。</p>`,
    ),
    truth: {
      role_breadth: { choice: "100", phrases: ["SEOとメール施策"] },
      collaboration: { choice: "0", phrases: ["一人で受け持ちます"] },
    },
    rules: { schedule_flexibility: 100 },
  },
  {
    name: "カスタマーサクセス（日本語）",
    html: page(
      `<h1>カスタマーサクセス</h1>
       <p>導入後のお客様とオンラインで日常的にやり取りし、定着まで伴走します。</p>
       <p>問い合わせへの回答は決められた手順とテンプレートに沿って進めます。</p>`,
    ),
    truth: {
      customer_contact: { choice: "100", phrases: ["日常的にやり取り"] },
      autonomy: { choice: "0", phrases: ["決められた手順"] },
    },
  },
  {
    name: "Business Planning (English)",
    html: page(
      `<h1>Business Planning</h1>
       <p>You will explore business areas the company has never entered.</p>
       <p>Each planner drives an initiative individually from idea to launch.</p>`,
    ),
    truth: {
      growth_direction: { choice: "100", phrases: ["never entered"] },
      collaboration: { choice: "0", phrases: ["individually"] },
    },
  },
];

/**
 * Regression for the production case (a Go backend posting on an ATS page,
 * about 10,000 characters): plenty of text, but every explicit statement
 * except collaboration is worded without the old selector's keywords, so
 * the old pipeline sent Jev only collaboration and left 7 axes unknown.
 */
const filler = Array.from(
  { length: 80 },
  (_, index) =>
    `<p>サンプルペイXの第${index + 1}章として、請求書の発行、入金の消し込み、与信の審査、決済データの集計を一つの画面で扱う製品の背景と、導入企業が抱えていた経理業務の課題、その解決までの経緯を紹介します。製品は国内の中堅企業を中心に広く使われています。</p>`,
).join("");

export const productionRegression: PostingFixture = {
  name: "Backend Developer (Go) regression",
  html: page(
    `<h1>Backend Developer (Go)</h1>
     ${filler}
     <p>チームでコードレビューを行い、チームで品質に責任を持ちます。</p>
     <p>オフィスに来るのは月に数回程度で、ほとんどの日は自宅から働いています。</p>
     <p>開発の進め方や使う道具はメンバー自身が決めます。</p>
     <p>Goでの開発を深めながら、決済や与信など新たなドメインにも挑戦できます。</p>
     <p>市場の状況に応じて、開発の順序は週単位で入れ替わります。</p>
     <p>働く時間帯は各自で決められます。</p>
     <p>設計、実装、運用に加えて、採用面接にも関わります。</p>`,
  ),
  truth: {
    collaboration: { choice: "100", phrases: ["チームで品質に責任"] },
    work_location: { choice: "100", phrases: ["自宅から働いて"] },
    autonomy: { choice: "100", phrases: ["メンバー自身が決めます"] },
    growth_direction: { choice: "50", phrases: ["新たなドメイン"] },
    work_change: { choice: "100", phrases: ["週単位で入れ替わります"] },
    schedule_flexibility: { choice: "100", phrases: ["働く時間帯は各自"] },
    role_breadth: { choice: "100", phrases: ["採用面接にも関わります"] },
  },
};

/** The removed keyword selector's patterns, kept only to document the bug. */
export const OLD_KEYWORD_SELECTOR: Readonly<Record<string, RegExp>> = {
  work_location: /リモート|在宅|出社|出勤|勤務地|remote|on.?site|hybrid/i,
  autonomy: /裁量|自律|決定権|承認|手順|方針|autonom|ownership|decision/i,
  collaboration: /チーム|協働|共同|一人|個人|team|collaborat|individual/i,
  growth_direction:
    /専門性|専門分野|新しい領域|未経験|成長|specializ|new domain|learn/i,
  work_change: /変化|優先順位|定型|頻繁|予測可能|dynamic|priority|routine/i,
  schedule_flexibility:
    /勤務時間|始業|終業|フレックス|コアタイム|時差|schedule|flexible hours/i,
  role_breadth:
    /幅広|兼務|横断|担当領域|専門領域|複数領域|cross.functional|generalist/i,
  customer_contact:
    /顧客|利用者|ユーザー|接客|対話|customer|client|user contact/i,
};
