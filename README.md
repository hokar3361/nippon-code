# 🌸 NipponCode

![NipponCode Banner](.github/images/nipponcode-banner.png)

日本語に最適化された次世代AIコーディングアシスタント

[![npm version](https://img.shields.io/npm/v/nippon-code.svg)](https://www.npmjs.com/package/nippon-code)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 概要

NipponCodeは、日本の開発者のために作られた高性能なAIコーディングアシスタントです。ClaudeCodeのような対話型インターフェースを持ち、GPT、Claude、そして自作モデル（gpt-oss等）まで幅広くサポートします。

### 主な特徴

- 🎌 **日本語ファースト** - 日本語での自然な対話とコード生成
- 🤖 **マルチモデル対応** - OpenAI、Anthropic、カスタムモデルをサポート
- 💬 **対話型インターフェース** - 継続的な会話でコーディングをサポート
- ⚡ **高速レスポンス** - ストリーミング対応で快適な体験
- 🎯 **プロジェクト認識** - プロジェクト固有の設定とコンテキスト管理
- 🔧 **拡張可能** - プラグインとカスタムコマンドによる機能拡張

## インストール

### npxで直接実行（推奨）
```bash
npx nipponcode init
npx nipponcode chat
```

### グローバルインストール
```bash
npm install -g nipponcode
nipponcode init  # または ncode init
nipponcode chat  # または ncode chat
```

### ローカル開発
```bash
git clone https://github.com/nipponcode/nipponcode.git
cd nipponcode
npm install
npm run build
npm link
```

## クイックスタート

### 1. 初期設定
```bash
nipponcode init  # または ncode init
```

設定ウィザードが起動し、以下を設定できます：
- APIキー（OpenAI、Anthropic、カスタム）
- APIベースURL（カスタムエンドポイント対応）
- 使用モデル（gpt-4、claude-3、gpt-oss等）
- 使用言語（日本語/英語）

### 2. 対話開始
```bash
nipponcode chat  # または ncode chat
```

対話モードが起動し、継続的な会話が可能になります。

## 主要機能

### 対話型チャット
```bash
nipponcode chat

🌸 NipponCode v1.0.0
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


> こんにちは！Reactコンポーネントを作成してください
NipponCode: はい、Reactコンポーネントを作成します...

> /profile dev
プロファイル「dev」に切り替えました

> /help
利用可能なコマンド:
  /profile <name> - プロファイル切り替え
  /clear         - 会話履歴をクリア
  /save          - 会話を保存
  /exit          - 終了
```

### プロジェクト分析
```bash
nipponcode analyze  # または ncode analyze
```
プロジェクト全体を分析し、構造と依存関係を理解します。

### コード生成
```bash
nipponcode generate --type component --name UserProfile
```

### リファクタリング
```bash
nipponcode refactor --file src/index.js --improve performance
```

## 設定

### プロファイル機能

複数のAPI設定を管理できます：

`.nipponcode/profiles.json`:
```json
{
  "default": {
    "apiKey": "sk-...",
    "baseUrl": "https://api.openai.com/v1",
    "model": "gpt-4",
    "language": "ja"
  },
  "dev": {
    "apiKey": "custom-key",
    "baseUrl": "http://localhost:8000/v1",
    "model": "gpt-oss",
    "language": "ja"
  }
}
```

### プロジェクト設定

プロジェクトルートに`.nipponcode/config.md`を配置することで、プロジェクト固有の指示を設定できます（ClaudeCodeのCLAUDE.mdと同様）：

```markdown
# プロジェクト設定

## コーディングスタイル
- TypeScriptを使用
- 関数型プログラミングを優先
- テストファーストで開発

## プロジェクト構造
src/
  components/ - Reactコンポーネント
  utils/      - ユーティリティ関数
  types/      - 型定義
```

## スラッシュコマンド

対話中に使用できる特別なコマンド：

| コマンド | 説明 |
|---------|------|
| `/profile <name>` | プロファイル切り替え |
| `/clear` | 会話履歴をクリア |
| `/save [filename]` | 会話を保存 |
| `/load [filename]` | 会話を読み込み |
| `/context add <file>` | ファイルをコンテキストに追加 |
| `/context list` | 現在のコンテキストを表示 |
| `/settings` | 設定を表示/変更 |
| `/help` | ヘルプを表示 |
| `/exit` | 終了 |

## API対応

### OpenAI互換
- OpenAI GPT-3.5/4
- Azure OpenAI
- カスタムOpenAI互換API（gpt-oss等）

### Anthropic
- Claude 3 (Opus/Sonnet/Haiku)

### カスタムモデル
- VLLM
- Ollama
- LM Studio
- その他OpenAI互換API

## 開発者向け

### アーキテクチャ
```
src/
├── commands/        # CLIコマンド
├── agents/          # AI エージェント
├── config/          # 設定管理
├── session/         # セッション管理
├── utils/           # ユーティリティ
└── types/           # TypeScript型定義
```

### プラグイン開発
```typescript
// plugins/my-plugin.ts
export default {
  name: 'my-plugin',
  version: '1.0.0',
  commands: {
    '/mycommand': async (args: string[]) => {
      // カスタムコマンドの実装
    }
  }
}
```

### テスト
```bash
npm test
npm run test:watch
npm run test:coverage
```

## トラブルシューティング

### APIキーが保存されない
設定ファイル`.nipponcode/config.json`の権限を確認してください。

### 接続エラー
- ネットワーク接続を確認
- プロキシ設定を確認（`HTTP_PROXY`環境変数）
- APIエンドポイントのURLを確認

### モデルが応答しない
- APIキーの有効性を確認
- 使用量制限を確認
- モデル名が正しいか確認

## ロードマップ

- [ ] VSCode拡張機能
- [ ] GitHub Copilot統合
- [ ] ローカルLLM最適化
- [ ] マルチモーダル対応（画像入力）
- [ ] コード実行サンドボックス
- [ ] チーム共有機能
- [ ] プラグインマーケットプレイス

## コントリビューション

プルリクエストを歓迎します！

1. このリポジトリをフォーク
2. フィーチャーブランチを作成 (`git checkout -b feature/amazing-feature`)
3. 変更をコミット (`git commit -m 'Add amazing feature'`)
4. ブランチにプッシュ (`git push origin feature/amazing-feature`)
5. プルリクエストを作成

## ライセンス

MIT License - 詳細は[LICENSE](LICENSE)ファイルを参照してください。

## サポート

- 📧 Email: support@nipponcode.dev
- 💬 Discord: [NipponCode Community](https://discord.gg/nipponcode)
- 🐛 Issues: [GitHub Issues](https://github.com/nipponcode/nipponcode/issues)

## クレジット

NipponCodeは、ClaudeCodeやCursor、GitHub Copilotなどの素晴らしいツールにインスパイアされて作られました。

---

Made with ❤️ by Japanese developers, for Japanese developers