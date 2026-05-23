// ============================================================
// 住宅ローン借り換えキャンペーン監視 + Claude AI分析 v2
// ============================================================

// ===== 監視対象銀行 =====
const BANKS = [
  { name: "ソニー銀行",       url: "https://sonybank.jp/lp/hl/05.html" },
  { name: "住信SBIネット銀行", url: "https://www.netbk.co.jp/contents/lineup/home-loan/" },
  { name: "auじぶん銀行",     url: "https://www.jibunbank.co.jp/products/homeloan/" },
  { name: "PayPay銀行",      url: "https://www.paypay-bank.co.jp/mortgage/index.html" },
  { name: "りそな銀行",       url: "https://www.resonabank.co.jp/kojin/jutaku/" },  // 要確認
];
const KEYWORDS = ["キャンペーン", "金利優遇", "借り換え", "特別", "期間限定"];

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

  // 各銀行をスクレイピング
  BANKS.forEach(bank => {
    try {
      const html = UrlFetchApp.fetch(bank.url, {
        muteHttpExceptions: true,
        followRedirects:    true,
        headers: { "User-Agent": "Mozilla/5.0" },
        deadline: 10, // 1サイト最大10秒でスキップ
      }).getContentText("UTF-8");

      const found   = KEYWORDS.filter(kw => html.includes(kw));
      const excerpt = extractText(html, found);

      const prev    = props.getProperty(`prev_${bank.name}`) || "none";
      const current = found.length ? found.join(",") : "none";
      props.setProperty(`prev_${bank.name}`, current);

      const result = { ...bank, found, excerpt, changed: prev !== current };
      results.push(result);
      if (found.length) campaignBanks.push(result);

    } catch (e) {
      // タイムアウト・エラー時はスキップして記録
      const isTimeout = e.message.includes("Timeout") || e.message.includes("deadline");
      results.push({
        ...bank,
        error: isTimeout ? "タイムアウト（サイトの応答が遅いためスキップ）" : e.message,
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
// テキスト抽出（HTML → キーワード周辺のテキスト）
// ============================================================
function extractText(html, keywords) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi,  "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ").trim();

  return keywords.map(kw => {
    const i = text.indexOf(kw);
    return i !== -1
      ? text.substring(Math.max(0, i - 80), Math.min(text.length, i + 180)) + "…"
      : "";
  }).filter(Boolean).join("\n").substring(0, 1000);
}

// ============================================================
// Claude API でAI判断
// ============================================================
function analyzeWithClaude(campaignBanks, apiKey) {
  const banksText = campaignBanks.map(b =>
    `【${b.name}】\n検出ワード: ${b.found.join("・")}\n内容:\n${b.excerpt}`
  ).join("\n\n");

  const prompt = `あなたは住宅ローン借り換えの専門家です。
以下のキャンペーン情報を評価し、JSON配列のみ返してください（他のテキスト不要）。

${banksText}

形式:
[{"bank":"銀行名","score":"★1〜5","recommendation":"おすすめ／様子見／不要","reason":"50字以内","point":"注目ポイント"}]`;

  try {
    const res  = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
      method:             "post",
      muteHttpExceptions: true,
      deadline: 30, // Claude API最大30秒
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
    const text = JSON.parse(res.getContentText()).content[0].text
      .replace(/```json|```/g, "").trim();
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
      ? `🔴 キャンペーン検出: ${r.found.join("・")}${r.changed ? "（NEW）" : ""}`
      : "✅ 通常状態";
    body += `【${r.name}】\n${status}\n`;

    const ai = aiAnalysis.find?.(a => a.bank === r.name);
    if (ai) {
      body += `🤖 AI評価: ${ai.score} ${ai.recommendation}\n   理由: ${ai.reason}\n   注目: ${ai.point}\n`;
    }
    body += `URL: ${r.url}\n\n`;
  });

  body += `${"─".repeat(40)}\nチェック日時: ${now}\n※ GAS + Claude AIにより自動送信`;
  GmailApp.sendEmail(notifyEmail, subject, body);
  Logger.log("送信完了: " + subject);
}
