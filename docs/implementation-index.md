# NipponCode 実装索引

## クイックリファレンス - どこに何があるか

### 🎯 主要機能の実装場所

| 機能 | ファイル | 主要クラス/関数 | 行番号 |
|------|----------|----------------|--------|
| **チャット処理** | `src/agents/chat.ts` | `ChatAgent.chat()` | 75-103 |
| **ストリーミングチャット** | `src/agents/chat.ts` | `ChatAgent.streamChat()` | 105-132 |
| **メッセージ構築** | `src/agents/chat.ts` | `ChatAgent.buildMessages()` | 134-178 |
| **コンテキスト管理** | `src/agents/chat.ts` | `ChatAgent.addContext()` | 208-221 |
| **対話型UI** | `src/commands/interactive-chat.ts` | `InteractiveChat` | - |
| **OpenAI通信** | `src/providers/openai.ts` | `OpenAIProvider.complete()` | 71-119 |
| **ストリーミング処理** | `src/providers/openai.ts` | `OpenAIProvider.streamComplete()` | 122-189 |
| **設定管理** | `src/config/index.ts` | `ConfigManager` | 21-194 |
| **CLIエントリ** | `src/cli.ts` | `main()` | 17-97 |

### 📁 ディレクトリ構造と責務

```
src/
├── agents/              # AIエージェント実装
│   ├── chat.ts          # メインチャットロジック（272行）
│   └── simple-chat.ts   # シンプルチャット実装
│
├── analyzers/           # コード分析機能
│   └── project.ts       # プロジェクト分析（未接続）
│
├── commands/            # CLIコマンド実装
│   ├── analyze.ts       # analyzeコマンド
│   ├── chat.ts          # chatコマンド（20行）
│   ├── config.ts        # configコマンド
│   ├── init.ts          # initコマンド
│   └── interactive-chat.ts # 対話型チャットUI
│
├── config/              # 設定管理
│   └── index.ts         # ConfigManager（194行）
│
├── providers/           # AIプロバイダー層
│   ├── base.ts          # 抽象基底クラス（65行）
│   ├── index.ts         # ProviderFactory
│   └── openai.ts        # OpenAI実装（252行）
│
├── session/             # セッション管理
│   ├── manager.ts       # SessionManager
│   └── simple-manager.ts # SimpleSessionManager
│
├── utils/               # ユーティリティ
│   ├── ascii-art.ts     # バナー表示
│   ├── files.ts         # ファイル操作
│   └── setup.ts         # 環境セットアップ
│
├── cli.ts               # CLIエントリーポイント（104行）
└── setup.ts             # 初期設定
```

### 🔧 設定と環境変数

| 設定項目 | 環境変数 | デフォルト値 | 説明 |
|----------|----------|-------------|------|
| apiBaseUrl | VLLM_API_BASE_URL | `https://api.openai.com/v1` | APIエンドポイント |
| apiKey | VLLM_API_KEY | なし | APIキー |
| model | VLLM_MODEL | `gpt-4-turbo-preview` | 使用モデル |
| maxTokens | VLLM_MAX_TOKENS | 4096 | 最大出力トークン |
| temperature | VLLM_TEMPERATURE | 0.7 | 生成温度 |
| debug | VLLM_DEBUG | false | デバッグモード |
| sessionDir | VLLM_SESSION_DIR | `.nipponcode/sessions` | セッション保存先 |
| maxParallel | VLLM_MAX_PARALLEL | 5 | 並列処理数 |
| analysisDepth | VLLM_ANALYSIS_DEPTH | 3 | 分析深度 |

### 🔑 重要なインターフェース定義

**Message** (`src/providers/base.ts:3-6`)
```typescript
interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
```

**Context** (`src/agents/chat.ts:7-12`)
```typescript
interface Context {
  type: 'file' | 'directory' | 'code' | 'system';
  path?: string;
  name?: string;
  content: string;
}
```

**Session** (`src/agents/chat.ts:14-25`)
```typescript
interface Session {
  id: string;
  name: string;
  messages: Message[];
  contexts: Context[];
  metadata: {
    createdAt: Date;
    updatedAt: Date;
    model?: string;
    totalTokens?: number;
  };
}
```

**CompletionOptions** (`src/providers/base.ts:8-18`)
```typescript
interface CompletionOptions {
  messages: Message[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  stopSequences?: string[];
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
}
```

### 🚀 コマンド実装マップ

| コマンド | ファイル | エントリ関数 | 主な処理 |
|----------|----------|-------------|----------|
| init | `src/commands/init.ts` | `initCommand()` | 設定初期化、APIキー設定 |
| chat | `src/commands/chat.ts` | `chatCommand()` | 設定検証、InteractiveChat起動 |
| analyze | `src/commands/analyze.ts` | `analyzeCommand()` | プロジェクト分析（未実装） |
| config | `src/commands/config.ts` | `configCommand()` | 設定表示/変更 |

### 🔄 主要な処理フロー

#### チャット処理フロー
1. `cli.ts:main()` → コマンドパース
2. `commands/chat.ts:chatCommand()` → 設定検証
3. `commands/interactive-chat.ts:InteractiveChat.start()` → UI起動
4. `agents/chat.ts:ChatAgent.streamChat()` → メッセージ処理
5. `providers/openai.ts:OpenAIProvider.streamComplete()` → API通信
6. SSEパース → レスポンス表示

#### 設定読み込みフロー
1. `config/index.ts:loadDefaultConfig()` → デフォルト値
2. `config/index.ts:loadFromEnv()` → 環境変数
3. グローバル設定ファイル読み込み
4. ローカル設定ファイル読み込み

### 📝 トークン管理の実装詳細

**場所**: `src/agents/chat.ts:134-178` (buildMessages メソッド)

**処理順序**:
1. システムプロンプトの追加（行139-141）
2. コンテキストの追加（行144-150）
3. 利用可能トークン計算（行153-155）
4. メッセージ履歴の逆順処理（行163）
5. トークン制限チェック（行167-170）

### 🌊 ストリーミング処理の実装詳細

**場所**: `src/providers/openai.ts:122-189` (streamComplete メソッド)

**SSEパース処理**:
```typescript
// 行149-154: バッファリング処理
let buffer = '';
for await (const chunk of response.data) {
  buffer += chunk.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop() || '';
  // ...
}
```

### 🔍 デバッグポイント

| デバッグ対象 | ファイル:行番号 | 設定/変数 |
|-------------|---------------|-----------|
| API通信エラー | `openai.ts:115-118` | error.response確認 |
| トークン超過 | `chat.ts:167-170` | currentTokens変数 |
| SSEパースエラー | `openai.ts:178` | console.error出力 |
| 設定読み込み | `config/index.ts:73-74` | console.warn出力 |

### 🚨 エラーハンドリング箇所

| エラー種別 | 場所 | 処理 |
|-----------|------|------|
| API通信エラー | `openai.ts:114-119` | エラーメッセージ構築 |
| 設定検証エラー | `chat.ts:8-14` | 検証エラー表示 |
| ファイル読み込みエラー | `config/index.ts:73-84` | 警告表示、デフォルト使用 |

### 📊 モデル設定

**場所**: `src/providers/openai.ts:199-214`

```typescript
const modelLimits = {
  'gpt-5': 128000,
  'gpt-5-mini': 128000,
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'gpt-4-turbo-preview': 128000,
  'gpt-4-turbo': 128000,
  'gpt-4': 8192,
  'gpt-4-32k': 32768,
  'gpt-3.5-turbo': 16385,
}
```

---
この索引は、コードベースの迅速なナビゲーションと理解を支援するために作成されました。
更新日: 2025-08-20
バージョン: 0.1.0