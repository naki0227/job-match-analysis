// Two-digit prefecture codes published by Japan's Statistics Bureau.
export const PREFECTURE_CODES = Object.freeze([
  "01",
  "02",
  "03",
  "04",
  "05",
  "06",
  "07",
  "08",
  "09",
  "10",
  "11",
  "12",
  "13",
  "14",
  "15",
  "16",
  "17",
  "18",
  "19",
  "20",
  "21",
  "22",
  "23",
  "24",
  "25",
  "26",
  "27",
  "28",
  "29",
  "30",
  "31",
  "32",
  "33",
  "34",
  "35",
  "36",
  "37",
  "38",
  "39",
  "40",
  "41",
  "42",
  "43",
  "44",
  "45",
  "46",
  "47",
] as const);

export type PrefectureCode = (typeof PREFECTURE_CODES)[number];

export function parsePrefectureCode(value: unknown): PrefectureCode {
  const code = PREFECTURE_CODES.find((candidate) => candidate === value);
  if (code === undefined) {
    throw new RangeError("Unknown prefecture code");
  }
  return code;
}

export const PREFECTURE_NAMES = Object.freeze([
  "北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県","茨城県",
  "栃木県","群馬県","埼玉県","千葉県","東京都","神奈川県","新潟県","富山県",
  "石川県","福井県","山梨県","長野県","岐阜県","静岡県","愛知県","三重県",
  "滋賀県","京都府","大阪府","兵庫県","奈良県","和歌山県","鳥取県","島根県",
  "岡山県","広島県","山口県","徳島県","香川県","愛媛県","高知県","福岡県",
  "佐賀県","長崎県","熊本県","大分県","宮崎県","鹿児島県","沖縄県",
] as const);

export function prefectureCodeFromName(value: unknown): PrefectureCode {
  const index = PREFECTURE_NAMES.findIndex((name) => name === value);
  if (index < 0) throw new RangeError("Unknown prefecture name");
  return PREFECTURE_CODES[index]!;
}
