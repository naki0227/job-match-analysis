const article = document.createElement("article");
article.dataset.job = "";
article.innerHTML =
  "<h1>ソフトウェアエンジニア</h1><p>公開求人情報のテスト用本文です。チームでウェブサービスの設計、実装、運用を担当します。勤務先は東京都で、募集要件と仕事内容を公開しています。経験に応じて設計レビュー、品質改善、障害対応も担当します。</p>";
document.querySelector("#job").append(article);
