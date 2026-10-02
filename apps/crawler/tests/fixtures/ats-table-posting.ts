/**
 * Synthetic posting shaped like the production regression (an ATS page
 * whose conditions are a th/td table, the salary a dt/dd pair inside a
 * cell, and the work style a free-text pre block). No real company text.
 */
export const atsTablePosting = `<html><body>
<nav>採用トップ 求人一覧</nav>
<main>
  <article>
    <section>
      <h2>業務内容</h2>
      <p>配属部署により業務内容は異なりますが、以下のような業務を想定しています。</p>
      <ul>
        <li>法人向けSaaSプロダクトの設計・開発・運用</li>
        <li>各プロダクトのテックリード業務</li>
      </ul>
      <h2>求めるスキル・経験</h2>
      <ul>
        <li>Webアプリケーションの開発経験3年以上</li>
        <li>チームでのコードレビュー経験</li>
      </ul>
      <h2>あると望ましいスキル・経験</h2>
      <ul><li>英語でのコミュニケーション経験</li></ul>
    </section>
    <section>
      <table><tbody>
        <tr><th>職種 / 募集ポジション</th><td>【エンジニア】オープンポジション（東京・大阪・福岡）</td></tr>
        <tr><th>雇用形態</th><td>正社員</td></tr>
        <tr><th>給与</th><td><dl><dt>年収</dt><dd id="salary">600万円 〜 1600万円</dd><dd><pre></pre></dd></dl></td></tr>
        <tr><th>勤務地</th><td><ul><li>100-0001 東京都千代田区サンプル1-1 <a href="#">地図で確認</a></li></ul>
          <pre>■その他
  -福岡開発拠点
  -大阪開発拠点</pre></td></tr>
        <tr><th>働き方(出社・リモート)</th><td><pre>ハイブリッドワークスタイル
・原則、週2出社必須・週3以上の出社推奨（会社、業務状況により変動あり）
・出社曜日は所属チームにより異なる</pre></td></tr>
        <tr><th>休日・休暇</th><td><pre>■土曜日・日曜日・国民の祝日
■年次有給休暇</pre></td></tr>
      </tbody></table>
    </section>
  </article>
</main>
<footer>© Sample</footer>
</body></html>`;
