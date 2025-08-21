import { Task, TaskStep } from '../planning/interfaces';
import { fileOperations, FileOperation } from './file-operations';
import { commandRunner, CommandResult } from './command-runner';
import { platformDetector } from '../utils/platform-detector';
import { ProgressTracker } from './progress-tracker';

export interface ExecutionOptions {
  dryRun?: boolean;
  interactive?: boolean;
  autoApprove?: boolean;
  maxRetries?: number;
  continueOnError?: boolean;
  verbose?: boolean;
}

export interface ExecutionResult {
  success: boolean;
  task: Task;
  completedSteps: TaskStep[];
  failedSteps: TaskStep[];
  outputs: Map<string, any>;
  errors: Error[];
  duration: number;
}

export interface StepExecutor {
  type: 'file' | 'command' | 'code';
  execute: (step: TaskStep, context: ExecutionContext) => Promise<StepResult>;
}

export interface ExecutionContext {
  workingDir: string;
  env: NodeJS.ProcessEnv;
  outputs: Map<string, any>;
  options: ExecutionOptions;
  tracker: ProgressTracker;
}

export interface StepResult {
  success: boolean;
  output?: any;
  error?: Error;
  retry?: boolean;
}

export class AutonomousExecutor {
  private executors: Map<string, StepExecutor>;
  private context: ExecutionContext;
  private tracker: ProgressTracker;

  constructor(options: ExecutionOptions = {}) {
    this.executors = new Map();
    this.tracker = new ProgressTracker();
    
    this.context = {
      workingDir: process.cwd(),
      env: process.env,
      outputs: new Map(),
      options: {
        dryRun: false,
        interactive: false,
        autoApprove: true,
        maxRetries: 3,
        continueOnError: false,
        verbose: false,
        ...options
      },
      tracker: this.tracker
    };

    this.registerDefaultExecutors();
  }

  private registerDefaultExecutors(): void {
    // ファイル操作エグゼキューター
    this.registerExecutor('file', {
      type: 'file',
      execute: async (step, context) => {
        try {
          const operation = this.parseFileOperation(step);
          const result = await fileOperations.executeOperation(operation);
          
          if (result.success) {
            context.outputs.set(step.id, result);
            return { success: true, output: result };
          } else {
            return { 
              success: false, 
              error: result.error || new Error(result.message),
              retry: true 
            };
          }
        } catch (error) {
          return { 
            success: false, 
            error: error as Error,
            retry: true 
          };
        }
      }
    });

    // コマンド実行エグゼキューター
    this.registerExecutor('command', {
      type: 'command',
      execute: async (step, context) => {
        try {
          const command = this.parseCommand(step);
          const result = await commandRunner.run(command, {
            cwd: context.workingDir,
            env: context.env,
            dryRun: context.options.dryRun,
            silent: !context.options.verbose
          });
          
          if (result.success) {
            context.outputs.set(step.id, result);
            return { success: true, output: result };
          } else {
            return { 
              success: false, 
              error: result.error || new Error(result.stderr),
              retry: this.shouldRetryCommand(result) 
            };
          }
        } catch (error) {
          return { 
            success: false, 
            error: error as Error,
            retry: true 
          };
        }
      }
    });

    // コード生成エグゼキューター
    this.registerExecutor('code', {
      type: 'code',
      execute: async (step, context) => {
        try {
          const { filePath, content } = this.parseCodeGeneration(step);
          
          // ファイルが存在するか確認
          const exists = await fileOperations.exists(filePath);
          
          const operation: FileOperation = {
            type: exists ? 'update' : 'create',
            path: filePath,
            content: content,
            backup: exists
          };
          
          const result = await fileOperations.executeOperation(operation);
          
          if (result.success) {
            context.outputs.set(step.id, result);
            return { success: true, output: result };
          } else {
            return { 
              success: false, 
              error: result.error || new Error(result.message),
              retry: false 
            };
          }
        } catch (error) {
          return { 
            success: false, 
            error: error as Error,
            retry: false 
          };
        }
      }
    });
  }

  registerExecutor(type: string, executor: StepExecutor): void {
    this.executors.set(type, executor);
  }

  async executeTask(task: Task): Promise<ExecutionResult> {
    const startTime = Date.now();
    const completedSteps: TaskStep[] = [];
    const failedSteps: TaskStep[] = [];
    const errors: Error[] = [];

    // プラットフォーム検出
    await platformDetector.detect();
    
    // タスク開始
    this.tracker.startTask(task.id, task.name);
    console.log(`\n🚀 Starting autonomous execution: ${task.name}\n`);

    // 各ステップを実行
    for (const step of (task.steps || [])) {
      const stepResult = await this.executeStep(step, task);
      
      if (stepResult.success) {
        completedSteps.push(step);
      } else {
        failedSteps.push(step);
        if (stepResult.error) {
          errors.push(stepResult.error);
        }
        
        // エラー時の処理
        if (!this.context.options.continueOnError) {
          console.error(`\n❌ Execution failed at step: ${step.name}`);
          break;
        }
      }
    }

    // タスク完了
    const success = failedSteps.length === 0;
    this.tracker.completeTask(task.id, success ? 'success' : 'failure');
    
    const duration = Date.now() - startTime;
    
    // 結果サマリー表示
    this.displayExecutionSummary(completedSteps, failedSteps, duration);

    return {
      success,
      task,
      completedSteps,
      failedSteps,
      outputs: this.context.outputs,
      errors,
      duration
    };
  }

  private async executeStep(step: TaskStep, _task: Task): Promise<StepResult> {
    console.log(`\n📌 Executing: ${step.name}`);

    // ステップタイプの判定
    const stepType = this.determineStepType(step);
    const executor = this.executors.get(stepType);

    if (!executor) {
      const error = new Error(`No executor found for step type: ${stepType}`);
      // this.tracker.updateStep(task.id, step.id, 'failed');
      return { success: false, error };
    }

    // リトライロジック
    let retries = 0;
    let result: StepResult;

    do {
      result = await executor.execute(step, this.context);
      
      if (result.success) {
        console.log(`✅ Completed: ${step.name}`);
        break;
      }

      if (result.retry && retries < (this.context.options.maxRetries || 3)) {
        retries++;
        console.log(`⚠️ Retrying step (${retries}/${this.context.options.maxRetries}): ${step.name}`);
        await this.delay(1000 * retries); // 指数バックオフ
      } else {
        console.error(`❌ Failed: ${step.name}`);
        if (result.error) {
          console.error(`   Error: ${result.error.message}`);
        }
        break;
      }
    } while (result.retry);

    return result;
  }

  private determineStepType(step: TaskStep): string {
    const description = step.description.toLowerCase();
    
    // ファイル操作の判定
    if (description.includes('create file') || 
        description.includes('update file') ||
        description.includes('delete file') ||
        description.includes('write') ||
        description.includes('edit')) {
      return 'file';
    }
    
    // コマンド実行の判定
    if (description.includes('run') ||
        description.includes('execute') ||
        description.includes('install') ||
        description.includes('build') ||
        description.includes('test') ||
        description.includes('npm') ||
        description.includes('yarn') ||
        description.includes('git')) {
      return 'command';
    }
    
    // コード生成の判定
    if (description.includes('generate') ||
        description.includes('implement') ||
        description.includes('add code') ||
        description.includes('create function') ||
        description.includes('create class')) {
      return 'code';
    }
    
    // デフォルト
    return 'command';
  }

  private parseFileOperation(step: TaskStep): FileOperation {
    const metadata = step.metadata || {};
    const description = step.description.toLowerCase();
    
    let type: FileOperation['type'] = 'create';
    if (description.includes('update') || description.includes('edit')) {
      type = 'update';
    } else if (description.includes('delete') || description.includes('remove')) {
      type = 'delete';
    } else if (description.includes('rename') || description.includes('move')) {
      type = 'rename';
    } else if (description.includes('copy')) {
      type = 'copy';
    }
    
    return {
      type,
      path: metadata.path || step.output || '',
      content: metadata.content || '',
      newPath: metadata.newPath,
      backup: metadata.backup !== false
    };
  }

  private parseCommand(step: TaskStep): string {
    const metadata = step.metadata || {};
    
    // メタデータにコマンドが明示的に指定されている場合
    if (metadata.command) {
      return metadata.command;
    }
    
    // 説明からコマンドを抽出
    const description = step.description;
    
    // バッククォートで囲まれたコマンドを抽出
    const codeMatch = description.match(/`([^`]+)`/);
    if (codeMatch) {
      return codeMatch[1];
    }
    
    // 一般的なコマンドパターンの検出
    if (description.includes('npm install')) return 'npm install';
    if (description.includes('npm test')) return 'npm test';
    if (description.includes('npm run build')) return 'npm run build';
    if (description.includes('git init')) return 'git init';
    if (description.includes('git add')) return 'git add .';
    if (description.includes('git commit')) return `git commit -m "${metadata.message || 'Auto commit'}"`;
    
    // デフォルト
    return step.input || description;
  }

  private parseCodeGeneration(step: TaskStep): { filePath: string; content: string } {
    const metadata = step.metadata || {};
    
    return {
      filePath: metadata.path || step.output || 'generated.js',
      content: metadata.content || step.input || '// Generated code\n'
    };
  }

  private shouldRetryCommand(result: CommandResult): boolean {
    const stderr = result.stderr.toLowerCase();
    
    // リトライ可能なエラーパターン
    const retryableErrors = [
      'econnreset',
      'etimedout',
      'enotfound',
      'network',
      'econnrefused',
      'socket hang up',
      'request timeout'
    ];
    
    return retryableErrors.some(error => stderr.includes(error));
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private displayExecutionSummary(
    completedSteps: TaskStep[],
    failedSteps: TaskStep[],
    duration: number
  ): void {
    console.log('\n' + '='.repeat(60));
    console.log('📊 Execution Summary');
    console.log('='.repeat(60));
    
    console.log(`✅ Completed: ${completedSteps.length} steps`);
    if (completedSteps.length > 0) {
      completedSteps.forEach(step => {
        console.log(`   • ${step.name}`);
      });
    }
    
    if (failedSteps.length > 0) {
      console.log(`\n❌ Failed: ${failedSteps.length} steps`);
      failedSteps.forEach(step => {
        console.log(`   • ${step.name}`);
      });
    }
    
    console.log(`\n⏱️ Duration: ${(duration / 1000).toFixed(2)}s`);
    console.log('='.repeat(60) + '\n');
  }

  async executeTasks(tasks: Task[]): Promise<ExecutionResult[]> {
    const results: ExecutionResult[] = [];
    
    for (const task of tasks) {
      const result = await this.executeTask(task);
      results.push(result);
      
      // タスクが失敗した場合、後続のタスクを実行しない（オプション）
      if (!result.success && !this.context.options.continueOnError) {
        console.error(`\n🛑 Stopping execution due to task failure: ${task.name}`);
        break;
      }
    }
    
    return results;
  }

  setOptions(options: ExecutionOptions): void {
    this.context.options = { ...this.context.options, ...options };
    
    // ドライランモードの設定を伝播
    if (options.dryRun !== undefined) {
      fileOperations.setDryRun(options.dryRun);
      commandRunner.setDryRun(options.dryRun);
    }
  }

  getContext(): ExecutionContext {
    return this.context;
  }

  reset(): void {
    this.context.outputs.clear();
    this.tracker = new ProgressTracker();
    this.context.tracker = this.tracker;
  }
}

export const autonomousExecutor = new AutonomousExecutor();