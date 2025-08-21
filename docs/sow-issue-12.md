# 作業範囲書（SOW） - Issue #12

## 作業範囲書（SOW）

### 1. 作業概要
- **Issue番号**: #12
- **目的**: NipponCodeを最高品質のAIコーディングアシスタントにするため、段階的な実行フローとインテリジェントなコマンド実行管理システムを実装する
- **スコープ**: 
  - 段階的実行フロー（プランニング→詳細化→実行→検証）の実装
  - コマンド実行管理システムの構築
  - ファイル編集管理機能の開発
  - 実行監視とフィードバックループの実装

### 2. 既存コード分析

#### 影響を受けるファイル:
- `src/cli.ts` - 新しいコマンド追加（/plan, /approve, /skip, /rollback, /safe-mode）
- `src/commands/chat.ts` - チャットコマンドの拡張
- `src/commands/interactive-chat.ts` - 新しいスラッシュコマンドの統合
- `src/agents/chat.ts` - エージェントの拡張

#### 新規作成ファイル:
- `src/planning/` - プランニングエンジン
- `src/execution/` - 実行管理システム
- `src/sandbox/` - サンドボックス実行環境
- `src/monitoring/` - 監視とトレーシング

#### 現在の実装の仕組み:
- 現在はシンプルなチャット対話型システム
- OpenAI SDK (v5.13.1) を使用したAPI通信
- セッション管理による会話履歴の保持
- 基本的なスラッシュコマンドの実装

#### 依存関係:
- OpenAI SDK
- commander (CLI)
- inquirer (対話型プロンプト)
- chalk (ターミナル出力)

### 3. リスク評価

#### デグレードの可能性: **Medium**
- 既存のチャット機能への影響を最小限に抑える設計が必要
- 新機能はオプトイン方式で導入

#### 影響範囲:
- チャット処理フロー全体
- コマンド実行システム
- ファイル操作機能（新規）

#### 軽減策:
- 段階的な実装（Phase 1-4）
- 各フェーズでの十分なテスト
- フィーチャーフラグによる機能のON/OFF
- ドライラン機能の実装
- サンドボックス環境での安全な実行

### 4. 設計思想

#### アーキテクチャ:
**2025年のベストプラクティスに基づくLLMエージェントアーキテクチャ**

```typescript
// 段階的実行フロー
interface ExecutionFlow {
  // フェーズ1: プランニング（計画と分解）
  planning: {
    analyzeRequest(userInput: string): Promise<TaskPlan>;
    decomposeTask(task: Task): Promise<SubTask[]>;
    validatePlan(plan: TaskPlan): Promise<ValidationResult>;
  };
  
  // フェーズ2: 詳細化（具体的な実行計画）
  detailing: {
    detailTask(task: SubTask): Promise<DetailedTask>;
    estimateResources(task: DetailedTask): ResourceEstimate;
    checkDependencies(tasks: DetailedTask[]): DependencyGraph;
  };
  
  // フェーズ3: 実行管理
  execution: {
    executeTask(task: DetailedTask): Promise<ExecutionResult>;
    monitorProgress(taskId: string): ProgressStream;
    handleError(error: ExecutionError): RecoveryStrategy;
  };
  
  // フェーズ4: 検証とフィードバック
  completion: {
    verifyResults(results: ExecutionResult[]): ValidationReport;
    generateReport(execution: CompletedExecution): string;
    learnFromExecution(execution: CompletedExecution): void;
  };
}

// コマンド実行管理システム
interface CommandExecutor {
  // 許可管理
  permissions: {
    askPermission(cmd: Command): Promise<Permission>;
    rememberChoice(cmd: Command, choice: Permission): void;
    checkPermissionCache(cmd: Command): Permission | null;
  };
  
  // 安全性検証（LLMによる判定）
  validation: {
    analyzeIntent(cmd: Command): Promise<CommandIntent>;
    checkSafety(cmd: Command): Promise<SafetyLevel>;
    suggestAlternative(cmd: Command): Promise<Command[]>;
  };
  
  // 実行制御
  execution: {
    dryRun(cmd: Command): Promise<DryRunResult>;
    sandbox(cmd: Command): Promise<SandboxResult>;
    execute(cmd: Command): Promise<ExecutionResult>;
    rollback(executionId: string): Promise<void>;
  };
}

// ファイル編集管理
interface FileEditor {
  // プレビュー
  preview: {
    showDiff(original: string, modified: string): string;
    explainChanges(diff: Diff): string;
    estimateImpact(changes: Change[]): ImpactAnalysis;
  };
  
  // 編集実行
  edit: {
    applyChanges(file: string, changes: Change[]): Promise<void>;
    validateSyntax(file: string, language: string): Promise<ValidationResult>;
    formatCode(file: string, style: FormatStyle): Promise<string>;
  };
  
  // ロールバック
  rollback: {
    createSnapshot(file: string): Promise<SnapshotId>;
    revertToSnapshot(snapshotId: SnapshotId): Promise<void>;
    listSnapshots(file: string): Promise<Snapshot[]>;
  };
}
```

#### 保守性:
- モジュラー設計による機能の独立性
- TypeScriptの型安全性を活用
- イベント駆動アーキテクチャによる疎結合
- 依存性注入によるテスタビリティの向上

#### ベストプラクティス:
**最新のリサーチ結果に基づく実装方針**

1. **ReAct Pattern with Memory (RAISE)**
   - 推論→行動→観察のループ
   - 永続メモリとワーキングメモリの組み合わせ
   
2. **Plan-and-Execute Architecture**
   - 大規模タスクの事前計画
   - 小規模モデルでのサブタスク実行
   - コスト最適化

3. **Safety-First Approach**
   - コンテナベースのサンドボックス（gVisor/Docker）
   - 最小権限の原則
   - ドライラン機能

4. **Observability**
   - OpenTelemetryによるトレーシング
   - ステップごとの入出力記録
   - リアルタイムストリーミング

#### リサーチ結果:
- **Mastra Framework**: TypeScript向けの最新エージェントフレームワーク、XStateベースの状態管理
- **LlamaIndex.TS**: TypeScriptでのLLMエージェント実装
- **Effect TypeScript**: 信頼性の高いエージェントシステム構築
- **サンドボックス技術**: gVisor、WebAssembly、Docker による安全な実行環境

### 5. 受け入れ基準

#### Phase 1（最優先実装）
- [ ] 基本的な段階的実行フロー（プランニング→詳細化→実行）が動作する
- [ ] プランをユーザーに提示し、承認を得る機能が実装されている
- [ ] タスクリスト管理とプログレス表示が機能する
- [ ] `/plan`, `/approve`, `/skip` コマンドが動作する

#### Phase 2
- [ ] コマンド実行の許可/拒否機能が実装されている
- [ ] 実行履歴の記憶と自動スキップが機能する
- [ ] ファイル編集時のDiff表示が実装されている
- [ ] ドライラン機能が動作する

#### Phase 3
- [ ] LLMによる意図判定が実装されている
- [ ] 安全性チェックが機能する
- [ ] 基本的なサンドボックス実行が可能
- [ ] ロールバック機能が動作する

#### Phase 4
- [ ] 完全な自律実行モードが実装されている
- [ ] 複数LLMセッションの協調動作が可能
- [ ] 学習機能（頻繁な操作の最適化）が実装されている

#### テストケース
- [ ] 複雑なタスクが適切に分解される
- [ ] 危険なコマンドが検出され、警告が表示される
- [ ] ドライランが正しく動作する
- [ ] ロールバックが正常に機能する
- [ ] エラー時の復旧処理が適切に動作する

### 6. 実装計画

#### Phase 1 実装項目（2週間）
1. **プランニングエンジン**
   - `src/planning/planner.ts` - タスク分解ロジック
   - `src/planning/task-manager.ts` - タスク管理
   - `src/planning/interfaces.ts` - 型定義

2. **実行フロー**
   - `src/execution/executor.ts` - 実行エンジン
   - `src/execution/progress-tracker.ts` - 進捗管理
   - `src/execution/state-machine.ts` - 状態管理（XState使用）

3. **UI/UX**
   - スラッシュコマンドの追加
   - プログレス表示の実装
   - 対話型承認フローの実装

#### 技術スタック追加
- xstate (状態管理)
- diff (差分表示)
- dockerode (Docker統合) - Phase 3
- OpenTelemetry (監視) - Phase 2

### 7. 成功指標
- 複雑なタスクの成功率: 80%以上
- ユーザー承認後の実行成功率: 95%以上
- エラー時の自動復旧率: 70%以上
- 平均タスク完了時間: 現行比50%短縮

---
作成日: 2025-08-21
作成者: Claude Opus
承認者: [承認待ち]