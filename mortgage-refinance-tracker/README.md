# mortgage-refinance-tracker

銀行の住宅ローン借り換えキャンペーンを自動監視し、Claude AIで評価・分析した結果をGmailで週次通知するツールです。

---

## 概要

- 大手銀行5行の住宅ローンページを週1回自動スクレイピング
- キャンペーンキーワードを検出し、前週からの変化を差分チェック
- キャンペーン検出時はClaude AIがおすすめ度・理由・注目ポイントを評価
- 毎週月曜日 午前8時にGmailでレポートを自動送信

---

## 技術構成

| コンポーネント | 詳細 |
|---|---|
| 実行環境 | Google Apps Script (GAS) |
| AI分析 | Anthropic Claude API（claude-sonnet-4-20250514） |
| 通知 | Gmail |
| スケジューリング | GAS 時間主導型トリガー（週次） |

---

## 監視対象銀行

| 銀行 | URL |
|---|---|
| ソニー銀行 | https://moneykit.net/visitor/hl/ |
| 住信SBIネット銀行 | https://www.netbk.co.jp/contents/lineup/mogage/ |
| auじぶん銀行 | https://www.jibunbank.co.jp/products/homeloan/ |
| PayPay銀行 | https://www.paypay-bank.co.jp/service/loan/homeloan/ |
| りそな銀行 | https://www.resonabank.co.jp/kojin/jutaku/ |

---

## セットアップ

### 前提条件

- Googleアカウント（GAS・Gmail用）
- Anthropic APIキー — [console.anthropic.com](https://console.anthropic.com) で取得
  - 推奨：Billing → Usage limits で月額上限を $2 に設定しておく

### 手順

**1. Google Apps Scriptプロジェクトを作成する**

[script.google.com](https://script.google.com) にアクセスし、新しいプロジェクトを作成。
`mortgage_monitor.gs` の内容を貼り付けて保存する。

**2. 認証情報を登録する**

`setCredentials()` 関数にAPIキーと通知先メールアドレスを入力し、一度だけ実行する。

```
関数名: setCredentials → ▶ 実行
```

> **重要：** 実行後すぐにコード内の値をダミー文字列に戻すこと。
> 認証情報はスクリプトプロパティに安全に保存されるため、コードに残してはいけない。

**3. アクセスを承認する**

初回実行時にGoogleの承認ダイアログが表示される。
「詳細」→「プロジェクト名に移動」→「許可」の順にクリックする。
「このアプリはGoogleで確認されていません」という警告は自作スクリプトでは毎回表示される正常な動作。

**4. 週次トリガーを設定する**

GASエディタの左メニュー「トリガー（時計アイコン）」→「トリガーを追加」：

| 設定項目 | 値 |
|---|---|
| 実行する関数 | `checkMortgageCampaigns` |
| イベントのソース | 時間主導型 |
| 時間ベースのトリガーのタイプ | 週タイマー |
| 曜日 | 毎週月曜日 |
| 時刻 | 午前8時〜9時 |

**5. 動作確認**

`checkMortgageCampaigns` を手動実行し、Gmailにレポートが届くことを確認する。

---

## 認証情報の管理

認証情報はGASのスクリプトプロパティで管理し、ソースコードには記載しない。

| プロパティキー | 内容 |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic Claude APIキー |
| `NOTIFY_EMAIL` | レポート送信先メールアドレス |

認証情報を変更する場合は `setCredentials()` を編集・実行後、すぐにコードを元に戻す。

---

## メールレポートの形式

**通常時（キャンペーンなし）：**
```
件名: 📊【週次レポート】住宅ローンキャンペーン監視 - 2026/05/26 08:05

【ソニー銀行】
✅ 通常状態
URL: https://...

【住信SBIネット銀行】
✅ 通常状態
...
```

**キャンペーン検出時：**
```
件名: 🚨【要確認】住宅ローンキャンペーン検出 - 2026/05/26 08:05

【ソニー銀行】
🔴 キャンペーン検出: キャンペーン・金利優遇（NEW）
🤖 AI評価: ★★★★☆ おすすめ
   理由: 市場水準より低金利、期間限定のため好機
   注目: 団信の内容を要確認
URL: https://...
```

---

## 注意事項

- GASスクリプトには6分の実行時間制限がある。銀行サイトの取得は1件あたり最大10秒、Claude APIは最大30秒のタイムアウトを設定している。
- 銀行サイトの構成変更により、キーワード検出が正常に動作しなくなる場合がある。エラーが続く場合は対象URLが有効か確認すること。
- 本ツールは個人的な情報収集を目的としたものであり、金融アドバイスを提供するものではない。

