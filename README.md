# 🌸 NipponCode

![NipponCode Banner](.github/images/nipponcode-banner.png)

Claude Code同等の全自動AIコーディングアシスタント（日本語対応）

[![npm version](https://img.shields.io/npm/v/nippon-code.svg)](https://www.npmjs.com/package/nippon-code)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## ⚠️ 開発状況

**全自動コーディング機能を実装中**
- ✅ 基本的なチャット機能
- ✅ OpenAI公式SDK (v5.13.1) への移行完了 (2025-08-21)
- ✅ **[Issue #17] エンジン問題修正完了** (2025-08-21)
  - 貼り付け時の分割問題を解決
  - エラー自動検出・修正機能追加
  - バックグラウンドコマンド実行対応
  - セッション自動保存・復元機能
- 🚧 **[開発中] 全自動実行システム** - Claude Codeレベルの自動実装機能
- 🚧 ファイル作成・編集機能の完全実装
- 🚧 コマンド自動実行の改善

## 概要

NipponCodeは、Claude Codeと同等の全自動AIコーディングアシスタントです。日本語で要求を伝えるだけで、計画立案から実装、テストまでを自動的に完了させます。

### 目指す動作

```
あなた: 「TodoアプリをReactで作って」

NipponCode:
[自動実行中...]
✓ 環境分析完了
✓ package.json作成
✓ Reactセットアップ
✓ コンポーネント生成 (TodoList.tsx, TodoItem.tsx)
✓ スタイリング適用
✓ ビルド成功
完了: Todoアプリを作成しました（実行時間: 45秒）
```

### 特徴（実装予定）

- 🤖 **全自動コーディング** - 要求から実装まで自動完遂（Claude Code同等）
- 🎌 **日本語対応** - 日本語での自然な要求理解
- ⚡ **マルチターン自動実行** - 複数ステップを自動的に進行
- 📝 **実際のファイル操作** - コード生成、ファイル作成・編集
- 🔧 **コマンド自動実行** - npm、git等のコマンドを自動実行
- 🛡️ **インテリジェント安全管理** - 危険な操作のみ承認要求
- 🔄 **エラー自動修正** - ビルドエラーを検知して自動修正

## インストール

### 前提条件

- Node.js 18以上
- OpenAIまたはAnthropicのAPIキー

### npxで直接実行（推奨）
```bash
npx nipponcode init
npx nipponcode chat
```

### グローバルインストール
```bash
npm install -g nipponcode
```

## 使い方

### 1. 初期設定

```bash
nipponcode init

# 以下を設定:
# - APIプロバイダー（OpenAI/Anthropic）
# - APIキー
# - デフォルトモデル
```

環境変数での設定も可能：
```bash
# .envファイルを作成
cp env.example .env

# APIキーを設定
OPENAI_API_KEY=your-api-key-here
# または
ANTHROPIC_API_KEY=your-api-key-here
```

### 2. 全自動実行（メイン機能）

```bash
nipponcode chat  # または ncode chat

# シンプルに要求を伝えるだけ
> 「RESTful APIをExpressで作って」
# → 自動的に全て実装

> 「このコードにテストを追加して」  
# → テストファイルを自動生成・実行

> 「TypeScriptに変換して」
# → 自動的に.tsファイルに変換
```

### 3. オプションコマンド（手動制御が必要な場合のみ）

```bash
nipponcode chat -m "こんにちは"  # 単発メッセージ
nipponcode chat -f file.txt       # ファイルコンテキスト付き
nipponcode chat --session dev     # セッション名指定
nipponcode chat --resume          # 前回のセッション再開
```

### 4. プロジェクト分析（実験的機能）

```bash
nipponcode analyze           # 現在のディレクトリを分析
nipponcode analyze src/      # 特定のパスを分析
nipponcode a --structure     # プロジェクト構造を表示
```

### 5. 設定管理

```bash
nipponcode config --list              # 設定を表示
nipponcode config --set model=gpt-4   # モデルを変更
nipponcode config --get model         # 現在のモデルを確認
```

## スラッシュコマンド（オプション）

チャットモード内で使用できる手動制御コマンド:

### 基本コマンド
| コマンド | 説明 | 使用例 |
|---------|------|--------|
| `/help` | ヘルプとコマンド一覧表示 | `/help` |
| `/exit`, `/quit` | 対話モード終了 | `/exit` |
| `/clear` | 画面クリア | `/clear` |
| `/profile` | プロファイル管理 | `/profile switch dev` |
| `/model` | AIモデル変更 | `/model gpt-4` |
| `/session` | セッション管理 | `/session new` |
| `/context` | コンテキスト表示 | `/context` |
| `/reload` | 設定再読み込み | `/reload` |
| `/config` | 現在の設定表示 | `/config` |
| `/save` | セッション保存 | `/save` |

### 実行制御コマンド（通常は不要）
| コマンド | 説明 | 使用例 |
|---------|------|--------|
| `/safe-mode` | 全操作で承認を求める（デバッグ用） | `/safe-mode` |
| `/abort` | 自動実行を緊急停止 | `/abort` |

### 開発中のコマンド
| コマンド | 説明 | 関連Issue | ステータス |
|---------|------|-----------|------------|
| `/execute-flow` | 高度な実行フロー | [#12](https://github.com/hokar3361/nippon-code/issues/12) | 🚧 実装中 |
| `/code` | コード生成・編集・実行 | [#10](https://github.com/hokar3361/nippon-code/issues/10) | 🚧 開発中 |
| `/run` | OSコマンド実行 | [#5](https://github.com/hokar3361/nippon-code/issues/5) | 📋 計画中 |
| `/file` | ファイル操作 | [#6](https://github.com/hokar3361/nippon-code/issues/6) | 📋 計画中 |
| `/template` | プロジェクトテンプレート生成 | [#9](https://github.com/hokar3361/nippon-code/issues/9) | 📋 計画中 |
| `/analyze` | プロジェクト分析 | - | 📋 計画中 |
| `/vendor` | APIベンダー切り替え | [#7](https://github.com/hokar3361/nippon-code/issues/7) | 📋 計画中 |
| `/thinking` | Thinkingモデル表示切替 | [#8](https://github.com/hokar3361/nippon-code/issues/8) | 📋 計画中 |
| `/sandbox` | サンドボックス環境管理 | [#10](https://github.com/hokar3361/nippon-code/issues/10) | 📋 計画中 |

## 開発ロードマップ

### Phase 1: 全自動実行システム（実装中）
- [ ] ファイル作成・編集の実装
- [ ] コマンド実行の実装
- [ ] エラー自動修正
- [ ] マルチターン自動実行

### Phase 2: 高度な機能
- [ ] プロジェクトテンプレート生成
- [ ] 大規模リファクタリング
- [ ] テスト自動生成・実行
- [ ] CI/CD設定の自動化

### Phase 3: エンタープライズ機能
- [ ] チーム共有設定
- [ ] カスタムワークフロー
- [ ] プラグインシステム
- [ ] 監査ログ

## 設定ファイル

### プロジェクト設定（.nipponcode/config.json）
```json
{
  "apiKey": "your-api-key",
  "apiBaseUrl": "https://api.openai.com/v1",
  "model": "gpt-4",
  "temperature": 0.7,
  "maxTokens": 4000,
  "streaming": true
}
```

### プロジェクトコンテキスト（.nipponcode/context.md）
```markdown
# プロジェクトコンテキスト
- フレームワーク: React/TypeScript
- スタイル: Tailwind CSS
- テスト: Jest
- 規約: ESLint + Prettier
```

## エラー対処

### APIキーエラー
```bash
# .envファイルを確認
cat .env

# 環境変数を直接設定
export OPENAI_API_KEY=your-key
```

### 接続エラー
```bash
# プロキシ設定が必要な場合
export HTTP_PROXY=http://proxy.example.com:8080
export HTTPS_PROXY=http://proxy.example.com:8080
```

## 貢献

プルリクエストを歓迎します！[CONTRIBUTING.md](CONTRIBUTING.md)をご覧ください。

## ライセンス

MIT License - 詳細は[LICENSE](LICENSE)をご覧ください。

## お問い合わせ

- Issues: [GitHub Issues](https://github.com/hokar3361/nippon-code/issues)
- Discussions: [GitHub Discussions](https://github.com/hokar3361/nippon-code/discussions)