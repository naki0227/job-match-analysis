/**
 * Browsing aid for choosing target roles across occupations. The saved value
 * is always the role name itself (any text), so categories and examples can
 * change without touching stored profiles.
 */
export type RoleCategory = { name: string; examples: readonly string[] };

export const roleCategories: readonly RoleCategory[] = [
  {
    name: "営業",
    examples: ["法人営業", "個人営業", "インサイドセールス", "営業企画"],
  },
  {
    name: "企画・事業開発",
    examples: [
      "事業企画",
      "経営企画",
      "新規事業開発",
      "プロダクトマネージャー",
    ],
  },
  {
    name: "マーケティング・広報",
    examples: ["Webマーケター", "広報・PR", "商品企画", "CRM・販促"],
  },
  {
    name: "カスタマーサクセス・サポート",
    examples: ["カスタマーサクセス", "カスタマーサポート", "コールセンター"],
  },
  {
    name: "人事・採用",
    examples: ["採用担当", "人事労務", "研修・組織開発", "人事制度企画"],
  },
  {
    name: "経理・財務・法務・総務",
    examples: ["経理", "財務", "法務", "総務", "一般事務"],
  },
  {
    name: "IT・エンジニア",
    examples: [
      "バックエンドエンジニア",
      "フロントエンドエンジニア",
      "インフラエンジニア",
      "社内SE",
      "データアナリスト",
    ],
  },
  {
    name: "デザイン・クリエイティブ",
    examples: [
      "UI/UXデザイナー",
      "Webデザイナー",
      "編集・ライター",
      "動画制作",
    ],
  },
  {
    name: "コンサル・専門職",
    examples: ["コンサルタント", "士業", "リサーチャー"],
  },
  {
    name: "研究・製造・技術",
    examples: ["研究開発", "生産技術", "品質管理", "施工管理"],
  },
  {
    name: "医療・福祉",
    examples: ["看護師", "介護士", "保育士", "薬剤師"],
  },
  {
    name: "教育",
    examples: ["講師", "教員", "教材開発", "キャリアアドバイザー"],
  },
  {
    name: "販売・接客・サービス",
    examples: ["販売スタッフ", "店長", "ホテルスタッフ", "飲食スタッフ"],
  },
  {
    name: "物流・運輸",
    examples: ["物流管理", "ドライバー", "購買・調達"],
  },
];

export const MAX_ROLE_LENGTH = 60;
