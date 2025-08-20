# NipponCode コア機能仕様書

## 1. チャット機能

### 1.1 ChatAgent クラス

**ファイル**: `src/agents/chat.ts`

#### 責務
AIプロバイダーとの対話を管理し、セッション状態を維持する

#### 主要メソッド

##### `constructor(session: Session)`
- セッションの初期化
- システムプロンプトの構築
- ストリーミング設定の読み込み

##### `chat(message: string): Promise<string>`
- 同期的なチャット処理
- メッセージ履歴への追加
- トークン使用量の記録

##### `streamChat(message: string): AsyncGenerator<string>`
- ストリーミング対応のチャット処理
- リアルタイムレスポンス生成
- 完了後の履歴保存

##### `buildMessages(): Message[]`
- システムプロンプトの設定
- コンテキストの注入
- トークン制限を考慮した履歴管理
- 最新メッセージを優先的に含める

##### `addContext(context: Context): void`
- ファイル、ディレクトリ、コード、システム情報の追加
- 既存コンテキストの更新

#### トークン管理戦略
```
最大トークン数 = モデル固有の上限
予約トークン = maxTokens設定値（出力用）
利用可能トークン = 最大トークン数 - 予約トークン

優先順位：
1. システムプロンプト
2. コンテキスト情報
3. 新しいメッセージから順に履歴を追加
```

### 1.2 InteractiveChat クラス

**ファイル**: `src/commands/interactive-chat.ts`

#### 責務
ユーザーとの対話インターフェースを提供

#### 主要機能
- プロンプト表示
- 入力受付（Inquirer.js使用）
- ストリーミング/非ストリーミング応答
- セッション管理
- 特殊コマンド処理

#### 特殊コマンド
- `exit/quit`: チャット終了
- `clear`: 履歴クリア
- `help`: ヘルプ表示
- `session`: セッション情報表示

## 2. プロバイダー管理

### 2.1 AIProvider 抽象クラス

**ファイル**: `src/providers/base.ts`

#### 必須実装メソッド
```typescript
abstract complete(options: CompletionOptions): Promise<CompletionResponse>
abstract streamComplete(options: CompletionOptions): AsyncGenerator<StreamChunk>
abstract estimateTokens(text: string): number
abstract getMaxTokens(): number
abstract getName(): string
abstract getAvailableModels(): Promise<string[]>
abstract healthCheck(): Promise<boolean>
```

### 2.2 OpenAIProvider 実装

**ファイル**: `src/providers/openai.ts`

#### 特徴
- GPT-3.5、GPT-4、GPT-4o、GPT-5対応
- tiktoken によるトークン数推定
- SSEパースによるストリーミング
- エラーハンドリング（ネットワーク、API）

#### モデル別設定
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

### 2.3 ProviderFactory

**ファイル**: `src/providers/index.ts`

#### 機能
- プロバイダーのインスタンス管理
- 設定に基づく自動選択
- 将来的な複数プロバイダー対応

## 3. 設定管理

### 3.1 ConfigManager

**ファイル**: `src/config/index.ts`

#### Singletonパターン実装
```typescript
private static instance: ConfigManager
public static getInstance(): ConfigManager
```

#### 設定項目
```typescript
interface VLLMConfig {
  apiBaseUrl: string       // API エンドポイント
  apiKey: string          // APIキー
  model: string           // 使用モデル
  maxTokens: number       // 最大出力トークン数
  temperature: number     // 生成温度（0.0-2.0）
  debug: boolean          // デバッグモード
  sessionDir: string      // セッション保存ディレクトリ
  maxParallel: number     // 並列処理数
  analysisDepth: number   // 分析深度
  streaming: boolean      // ストリーミング有効化
  language: 'ja' | 'en'   // 言語設定
}
```

#### 設定の優先順位
1. ローカル設定ファイル (`./.nipponcode/config.json`)
2. グローバル設定ファイル (`~/.nipponcode/config.json`)
3. 環境変数 (`VLLM_*`)
4. デフォルト値

#### 検証ロジック
- APIキーの存在確認
- temperatureの範囲チェック（0.0-2.0）
- maxTokensの最小値チェック（>= 1）

## 4. セッション管理

### 4.1 Session インターフェース

```typescript
interface Session {
  id: string              // UUID
  name: string            // セッション名
  messages: Message[]     // メッセージ履歴
  contexts: Context[]     // コンテキスト情報
  metadata: {
    createdAt: Date
    updatedAt: Date
    model?: string
    totalTokens?: number
  }
}
```

### 4.2 SessionManager

**ファイル**: `src/session/manager.ts`

#### 機能
- セッションの作成/読み込み/保存
- セッション一覧の取得
- セッションの削除
- 自動保存機能

#### 永続化
- 保存先: `.nipponcode/sessions/`
- フォーマット: JSON
- ファイル名: `{session-id}.json`

## 5. プロジェクト分析

### 5.1 ProjectAnalyzer

**ファイル**: `src/analyzers/project.ts`

#### 分析項目
- ディレクトリ構造
- ファイル一覧
- 依存関係（package.json解析）
- コード統計
- 複雑度計算

#### 分析オプション
```typescript
interface AnalysisOptions {
  depth: number           // 分析深度
  includeStructure: boolean
  includeDependencies: boolean
  includeComplexity: boolean
  ignore?: string[]       // 無視パターン
}
```

## 6. CLI コマンド

### 6.1 init コマンド
- 設定ファイルの生成
- APIキーの設定
- モデル選択
- 初期セットアップ

### 6.2 chat コマンド
- 対話モードの開始
- ファイル/ディレクトリコンテキストの追加
- セッション管理
- ストリーミング制御

### 6.3 analyze コマンド
- プロジェクト/ファイル分析
- 結果のファイル出力
- 分析深度の指定

### 6.4 config コマンド
- 設定の表示/変更
- 設定のリセット
- グローバル/ローカル設定の管理

## 7. ユーティリティ

### 7.1 ファイル操作 (`utils/files.ts`)
- ファイル読み込み
- ディレクトリ走査
- パス操作
- ignore パターン処理

### 7.2 セットアップ (`utils/setup.ts`)
- 環境初期化
- ディレクトリ作成
- 設定ファイル生成

### 7.3 ASCIIアート (`utils/ascii-art.ts`)
- バナー表示
- コンパクト表示
- カラー出力（chalk使用）

## 8. エラーハンドリング

### 8.1 エラー種別
- 設定エラー: 設定値の不正
- APIエラー: プロバイダーAPIのエラー
- ネットワークエラー: 接続失敗
- ファイルエラー: 読み書き失敗

### 8.2 エラー処理戦略
- ユーザーフレンドリーなエラーメッセージ
- デバッグモードでの詳細情報表示
- リトライ可能なエラーの識別
- グレースフルなフォールバック

## 9. 非同期処理

### 9.1 Promise/async-await
- 全ての非同期操作で一貫した使用
- エラーハンドリングの統一

### 9.2 ストリーミング
- AsyncGeneratorパターン
- バックプレッシャー対応
- 中断可能な処理

## 10. テスト戦略（未実装）

### 10.1 単体テスト
- 各クラスの個別テスト
- モック使用によるAPI分離

### 10.2 統合テスト
- コマンド実行テスト
- エンドツーエンドシナリオ

### 10.3 パフォーマンステスト
- トークン数推定の精度
- ストリーミング応答速度

---
更新日: 2025-08-20
バージョン: 0.1.0