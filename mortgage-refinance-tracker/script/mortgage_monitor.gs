// ============================================================
// 住宅ローン借り換えキャンペーン監視 + Claude AI分析 v3
// Google News RSS方式（タイムアウト対策済み）
// ============================================================

// ===== 監視対象銀行（検索クエリで管理）=====
const BANKS = [
  { name: "ソニー銀行",       query: "ソニー銀行 住宅ローン 借り換え キャンペーン" },
  { name: "住信SBIネット銀行", query: "住信SBIネット銀行 住宅ローン 借り換え キャンペーン" },
  { name: "auじぶん銀行",     query: "auじぶん銀行 住宅ローン 借り換え キャンペーン" },
  { name: "PayPay銀行",      query: "PayPay銀行 住宅ローン 借り換え キャンペーン" },
  { name: "りそな銀行",       query: "りそな銀行 住宅ローン 借り換え キャンペーン" },
];
const KEYWORDS = ["キャンペーン", "金利優遇", "借り換え", "特別", "期間限定", "引き下げ"];

// ============================================================
// 【初回のみ実行】認証情報をスクリプトプロパティに保存
// 実行後は必ずAPIキーとメールアドレスを元の文字列に戻すこと！
// ============================================================
function setCredentials() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty("ANTHROPIC_API_KEY", "sk-ant-xxxxxxxxxxxxxxxx"); // ← APIキー
  props.setProperty("NOTIFY_EMAIL",       "your@gmail.com");           // ← メールアドレス
  Logger.log("認証情報を保存しました");
}

// ============================================================
// メイン処理（週次トリガーで自動実行）
// ============================================================
function checkMortgageCampaigns() {
  const props       = PropertiesService.getScriptProperties();
  const apiKey      = props.getProperty("ANTHROPIC_API_KEY");
  const notifyEmail = props.getProperty("NOTIFY_EMAIL");

  if (!apiKey || !notifyEmail) {
    const missing = [!apiKey && "ANTHROPIC_API_KEY", !notifyEmail && "NOTIFY_EMAIL"]
      .filter(Boolean).join(", ");
    Logger.log(`【エラー】未設定: ${missing} → setCredentials()を実行してください`);
    return;
  }

  const results       = [];
  const campaignBanks = [];

  // Google News RSSで各銀行のキャンペーン情報を検索
  BANKS.forEach(bank => {
    try {
      const encodedQuery = encodeURIComponent(bank.query);
      const rssUrl = `https://news.google.com/rss/search?q=${encodedQuery}&hl=ja&gl=JP&ceid=JP:ja`;

      const xml = UrlFetchApp.fetch(rssUrl, {
        muteHttpExceptions: true,
        deadline: 10,
      }).getContentText("UTF-8");

      // RSSからニュース記事を抽出（最新3件）
      const items   = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
      const excerpt = items.slice(0, 3).map(item => {
        const title = (item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || [])[1]
          || (item.match(/<title>(.*?)<\/title>/) || [])[1] || "";
        const desc  = (item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) || [])[1]
          || (item.match(/<description>(.*?)<\/description>/) || [])[1] || "";
        const pubDate = (item.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] || "";
        return `[${pubDate.substring(0, 16)}] ${title} ${desc}`.substring(0, 160);
      }).join("\n");

      // キーワード検出
      const found = KEYWORDS.filter(kw => xml.includes(kw));

      // 前回差分チェック
      const prev    = props.getProperty(`prev_${bank.name}`) || "none";
      const current = found.length ? found.join(",") : "none";
      props.setProperty(`prev_${bank.name}`, current);

      const result = { ...bank, found, excerpt, changed: prev !== current };
      results.push(result);
      if (found.length) campaignBanks.push(result);

    } catch (e) {
      const isTimeout = e.message.includes("Timeout") || e.message.includes("deadline");
      results.push({
        ...bank,
        error: isTimeout ? "タイムアウト（ネットワーク遅延）" : e.message,
      });
    }
  });

  // AI分析（キャンペーン検出銀行のみ）
  const aiAnalysis = campaignBanks.length
    ? analyzeWithClaude(campaignBanks, apiKey)
    : [];

  sendReport(results, aiAnalysis, notifyEmail);
}

// ============================================================
// Claude API でAI判断
// ============================================================
function analyzeWithClaude(campaignBanks, apiKey) {
  const banksText = campaignBanks.map(b =>
    `【${b.name}】\n検出ワード: ${b.found.join("・")}\n最新ニュース:\n${b.excerpt}`
  ).join("\n\n");

  const prompt = `あなたは住宅ローン借り換えの専門家です。
以下のキャンペーン情報を評価し、JSON配列のみ返してください（他のテキスト不要）。

${banksText}

形式:
[{"bank":"銀行名","score":"★1〜5","recommendation":"おすすめ／様子見／不要","reason":"50字以内","point":"注目ポイント"}]`;

  try {
    const res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
      method:             "post",
      muteHttpExceptions: true,
      deadline:           30,
      headers: {
        "Content-Type":       "application/json",
        "x-api-key":         apiKey,
        "anthropic-version": "2023-06-01",
      },
      payload: JSON.stringify({
        model:      "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages:   [{ role: "user", content: prompt }],
      }),
    });
    const data = JSON.parse(res.getContentText());
    if (data.error) {
      Logger.log("Claude APIエラー: " + data.error.message);
      return [];
    }
    const text = data.content[0].text.replace(/```json|```/g, "").trim();
    return JSON.parse(text);
  } catch (e) {
    Logger.log("AI分析エラー: " + e.message);
    return [];
  }
}

// ============================================================
// メールレポート送信
// ============================================================
function sendReport(results, aiAnalysis, notifyEmail) {
  const now      = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy/MM/dd HH:mm");
  const hasAlert = results.some(r => r.found?.length && r.changed);

  const subject = hasAlert
    ? `🚨【要確認】住宅ローンキャンペーン検出 - ${now}`
    : `📊【週次レポート】住宅ローンキャンペーン監視 - ${now}`;

  let body = `住宅ローン借り換えキャンペーン 週次レポート\n${"=".repeat(40)}\n\n`;

  results.forEach(r => {
    if (r.error) {
      body += `【${r.name}】\n⚠️ ${r.error}\n\n`;
      return;
    }

    const status = r.found?.length
      ? `🔴 キャンペーン関連ニュースあり: ${r.found.join("・")}${r.changed ? "（NEW）" : ""}`
      : "✅ 特段の動きなし";

    body += `【${r.name}】\n${status}\n`;

    if (r.excerpt) {
      body += `最新ニュース:\n${r.excerpt}\n`;
    }

    const ai = aiAnalysis.find?.(a => a.bank === r.name);
    if (ai) {
      body += `🤖 AI評価: ${ai.score} ${ai.recommendation}\n   理由: ${ai.reason}\n   注目: ${ai.point}\n`;
    }

    body += "\n";
  });

  body += `${"─".repeat(40)}\nチェック日時: ${now}\n※ GAS + Claude AIにより自動送信`;
  GmailApp.sendEmail(notifyEmail, subject, body);
  Logger.log("送信完了: " + subject);
}
