# 🌸 NipponCode

![NipponCode Banner](.github/images/nipponcode-banner.png)

日本語対応のAIチャットツール（開発中）

[![npm version](https://img.shields.io/npm/v/nippon-code.svg)](https://www.npmjs.com/package/nippon-code)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
あ
## ⚠️ 開発状況

**このプロジェクトは現在開発初期段階です。**
- ✅ 基本的なチャット機能のみ実装済み
- 🚧 その他の機能は開発中

## 概要

NipponCodeは、日本語での対話に最適化されたシンプルなAIチャットツールです。OpenAIやAnthropicのAPIを使用して、ターミナル上で対話を行うことができます。

### 現在できること

- 💬 **AIとの対話** - OpenAI/AnthropicのAPIを使用したテキストチャット
- 🎌 **日本語対応** - 日本語での自然な会話
- ⚙️ **API設定** - APIキーとモデルの設定

### まだできないこと（開発予定）

- ❌ コード生成・編集機能
- ❌ プロジェクト分析
- ❌ ファイル操作
- ❌ リファクタリング支援
- ❌ コンテキスト管理

## インストール

### 前提条件

- Node.js 14以上
- OpenAIまたはAnthropicのAPIキー

### セットアップ

```bash
# リポジトリをクローン
git clone https://github.com/nipponcode/nipponcode.git
cd nipponcode

# 依存関係をインストール
npm install

# ビルド
npm run build

# グローバルにリンク（オプション）
npm link
```

## 使い方

### 1. 初期設定

```bash
# 環境変数ファイルを作成
cp env.example .env

# .envファイルを編集してAPIキーを設定
# OPENAI_API_KEY=your-api-key-here
# または
# ANTHROPIC_API_KEY=your-api-key-here
```

### 2. チャットを開始

```bash
# TypeScriptで直接実行
npm run dev

# または、ビルド後に実行
npm run build
node dist/cli.js chat
```

### 3. 対話する

```
🌸 NipponCode v0.1.0
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

> こんにちは！
NipponCode: こんにちは！何かお手伝いできることはありますか？

> exitと入力すると終了します
```

## 設定ファイル

`.nipponcode/config.json`:
```json
{
  "provider": "openai",
  "model": "gpt-3.5-turbo",
  "apiKey": "your-api-key",
  "language": "ja"
}
```

## プロジェクト構造

```
src/
├── agents/          # チャットエージェント
│   ├── chat.ts      # メインチャットロジック
│   └── simple-chat.ts
├── commands/        # CLIコマンド
│   ├── chat.ts      # チャットコマンド
│   ├── config.ts    # 設定コマンド
│   └── init.ts      # 初期化コマンド
├── providers/       # AIプロバイダー
│   ├── openai.ts    # OpenAI統合
│   └── base.ts      # ベースクラス
├── session/         # セッション管理
├── utils/           # ユーティリティ
└── cli.ts          # エントリーポイント
```

## 開発

### 開発モードで実行

```bash
npm run dev
```

### テスト（未実装）

```bash
npm test  # テストは今後実装予定
```

### ビルド

```bash
npm run build
```

## 今後の開発予定

### フェーズ1（現在）
- ✅ 基本的なチャット機能
- ✅ OpenAI/Anthropic API統合
- ⬜ エラーハンドリングの改善
- ⬜ セッション保存機能

### フェーズ2
- ⬜ マルチターン会話の改善
- ⬜ コンテキスト管理
- ⬜ プロンプトテンプレート

### フェーズ3
- ⬜ ファイル読み込み機能
- ⬜ 簡単なコード提案

### 将来的な構想
- ⬜ VSCode拡張機能
- ⬜ Web UI
- ⬜ ローカルモデル対応

## トラブルシューティング

### APIキーエラー
- `.env`ファイルにAPIキーが正しく設定されているか確認
- APIキーの有効性を確認

### 接続エラー
- インターネット接続を確認
- ファイアウォール設定を確認

## コントリビューション

このプロジェクトは開発初期段階のため、フィードバックや提案を歓迎します！

1. Issueで機能提案やバグ報告
2. プルリクエストは`develop`ブランチへ
3. コミットメッセージは日本語OK

## ライセンス

MIT License - 詳細は[LICENSE](LICENSE)ファイルを参照

## 注意事項

- **本プロジェクトはまだ実験的な段階です**
- **プロダクション環境での使用は推奨しません**
- **コーディング支援機能は未実装です**
- **現時点では単純なチャットボットとしてのみ機能します**

## お問い合わせ

- 🐛 Issues: [GitHub Issues](https://github.com/nipponcode/nipponcode/issues)

---

開発中のプロジェクトです。ご理解とご協力をお願いします。 🚧