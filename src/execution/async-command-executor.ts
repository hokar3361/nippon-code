import { spawn, ChildProcess, SpawnOptions } from 'child_process';
import { CommandExecutor } from './command-executor';

export interface BackgroundProcess {
  id: string;
  command: string;
  process: ChildProcess;
  startTime: Date;
  output: string[];
  error: string[];
  status: 'running' | 'completed' | 'failed' | 'killed';
  exitCode?: number;
}

export interface AsyncExecutionOptions {
  background?: boolean;
  detached?: boolean;
  timeout?: number;
  workingDirectory?: string;
  environment?: Record<string, string>;
  captureOutput?: boolean;
  onOutput?: (data: string) => void;
  onError?: (data: string) => void;
}

/**
 * 非同期コマンドエグゼキューター
 * 長時間実行コマンドのバックグラウンド実行をサポート
 */
export class AsyncCommandExecutor extends CommandExecutor {
  private backgroundProcesses: Map<string, BackgroundProcess> = new Map();
  private processIdCounter = 0;
  
  constructor() {
    super();
  }
  
  /**
   * コマンドを非ブロッキングで実行
   */
  public async executeAsync(
    commandStr: string,
    options: AsyncExecutionOptions = {}
  ): Promise<string | BackgroundProcess> {
    // サーバー起動コマンドの検出
    if (this.isServerCommand(commandStr)) {
      return await this.executeInBackground(commandStr, {
        ...options,
        background: true,
        detached: true,
        captureOutput: true
      });
    }
    
    // 通常のコマンド実行
    if (!options.background) {
      return await this.executeWithTimeout(commandStr, options);
    }
    
    // バックグラウンド実行
    return await this.executeInBackground(commandStr, options);
  }
  
  /**
   * サーバー起動コマンドかどうかを判定
   */
  private isServerCommand(command: string): boolean {
    const serverPatterns = [
      /^(python|python3)\s+.+\.py/,  // Python scripts
      /^flask\s+run/,
      /^django-admin\s+runserver/,
      /^python\s+-m\s+flask/,
      /^npm\s+(run\s+)?(start|dev|serve)/,
      /^node\s+.+\.js/,
      /^nodemon/,
      /^yarn\s+(start|dev)/,
      /^php\s+-S/,
      /^rails\s+server/,
      /^dotnet\s+run/,
      /^java\s+-jar/,
      /^go\s+run/,
      /^cargo\s+run/,
      /^http-server/,
      /^live-server/,
      /^webpack-dev-server/
    ];
    
    return serverPatterns.some(pattern => pattern.test(command.trim()));
  }
  
  /**
   * タイムアウト付きでコマンドを実行
   */
  private async executeWithTimeout(
    commandStr: string,
    options: AsyncExecutionOptions
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = options.timeout || 30000; // デフォルト30秒
      const [cmd, ...args] = this.parseCommandString(commandStr);
      
      const spawnOptions: SpawnOptions = {
        cwd: options.workingDirectory || process.cwd(),
        env: { ...process.env, ...options.environment },
        shell: true
      };
      
      const child = spawn(cmd, args, spawnOptions);
      let output = '';
      let errorOutput = '';
      let timedOut = false;
      
      // タイムアウトタイマー
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        reject(new Error(`Command timed out after ${timeout}ms: ${commandStr}`));
      }, timeout);
      
      child.stdout?.on('data', (data) => {
        const str = data.toString();
        output += str;
        if (options.onOutput) {
          options.onOutput(str);
        }
      });
      
      child.stderr?.on('data', (data) => {
        const str = data.toString();
        errorOutput += str;
        if (options.onError) {
          options.onError(str);
        }
      });
      
      child.on('close', (code) => {
        clearTimeout(timer);
        if (!timedOut) {
          if (code === 0) {
            resolve(output);
          } else {
            reject(new Error(`Command failed with code ${code}: ${errorOutput || output}`));
          }
        }
      });
      
      child.on('error', (error) => {
        clearTimeout(timer);
        if (!timedOut) {
          reject(error);
        }
      });
    });
  }
  
  /**
   * バックグラウンドでコマンドを実行
   */
  private async executeInBackground(
    commandStr: string,
    options: AsyncExecutionOptions
  ): Promise<BackgroundProcess> {
    const processId = `bg-${++this.processIdCounter}`;
    const [cmd, ...args] = this.parseCommandString(commandStr);
    
    const spawnOptions: SpawnOptions = {
      cwd: options.workingDirectory || global.process.cwd(),
      env: { ...global.process.env, ...options.environment },
      shell: true,
      detached: options.detached || false,
      stdio: options.detached ? 'ignore' as any : 'pipe'
    };
    
    const child = spawn(cmd, args, spawnOptions);
    
    const bgProcess: BackgroundProcess = {
      id: processId,
      command: commandStr,
      process: child,
      startTime: new Date(),
      output: [],
      error: [],
      status: 'running'
    };
    
    // デタッチモードの場合は親プロセスから切り離す
    if (options.detached) {
      child.unref();
      console.log(`🚀 プロセスをバックグラウンドで起動しました (PID: ${child.pid})`);
    }
    
    // 出力をキャプチャ
    if (options.captureOutput && !options.detached) {
      child.stdout?.on('data', (data) => {
        const str = data.toString();
        bgProcess.output.push(str);
        if (options.onOutput) {
          options.onOutput(str);
        }
        this.emit('background:output', { id: processId, data: str });
      });
      
      child.stderr?.on('data', (data) => {
        const str = data.toString();
        bgProcess.error.push(str);
        if (options.onError) {
          options.onError(str);
        }
        this.emit('background:error', { id: processId, data: str });
      });
    }
    
    child.on('close', (code) => {
      bgProcess.status = code === 0 ? 'completed' : 'failed';
      bgProcess.exitCode = code || undefined;
      this.emit('background:completed', { id: processId, code });
    });
    
    child.on('error', (error) => {
      bgProcess.status = 'failed';
      bgProcess.error.push(error.message);
      this.emit('background:error', { id: processId, error });
    });
    
    this.backgroundProcesses.set(processId, bgProcess);
    this.emit('background:started', { id: processId, command: commandStr });
    
    // サーバー起動の場合、起動確認を行う
    if (this.isServerCommand(commandStr)) {
      setTimeout(() => {
        this.checkServerStatus(bgProcess);
      }, 2000); // 2秒後にチェック
    }
    
    return bgProcess;
  }
  
  /**
   * サーバーの起動状態を確認
   */
  private async checkServerStatus(process: BackgroundProcess): Promise<void> {
    const portPatterns = [
      /(?:port|PORT)[:\s]+(\d+)/,
      /Listening on[:\s]+.*:(\d+)/,
      /http:\/\/[^:]+:(\d+)/,
      /:(\d{4,5})/
    ];
    
    // 出力からポート番号を検出
    const allOutput = [...process.output, ...process.error].join('\n');
    let port: string | null = null;
    
    for (const pattern of portPatterns) {
      const match = allOutput.match(pattern);
      if (match) {
        port = match[1];
        break;
      }
    }
    
    if (port) {
      console.log(`✅ サーバーがポート ${port} で起動しました`);
      console.log(`📌 URL: http://localhost:${port}`);
      this.emit('server:ready', { id: process.id, port });
    } else if (process.status === 'running') {
      console.log(`⏳ サーバーを起動中... (PID: ${process.process.pid})`);
    }
  }
  
  /**
   * バックグラウンドプロセスを終了
   */
  public killBackgroundProcess(processId: string): boolean {
    const process = this.backgroundProcesses.get(processId);
    if (!process || process.status !== 'running') {
      return false;
    }
    
    try {
      // プラットフォームに応じたkill処理
      process.process.kill('SIGTERM');
      
      process.status = 'killed';
      this.emit('background:killed', { id: processId });
      return true;
    } catch (error) {
      console.error(`Failed to kill process ${processId}:`, error);
      return false;
    }
  }
  
  /**
   * 全てのバックグラウンドプロセスを終了
   */
  public killAllBackgroundProcesses(): void {
    for (const [id, process] of this.backgroundProcesses) {
      if (process.status === 'running') {
        this.killBackgroundProcess(id);
      }
    }
  }
  
  /**
   * バックグラウンドプロセスのリストを取得
   */
  public getBackgroundProcesses(): BackgroundProcess[] {
    return Array.from(this.backgroundProcesses.values());
  }
  
  /**
   * 特定のバックグラウンドプロセスを取得
   */
  public getBackgroundProcess(processId: string): BackgroundProcess | undefined {
    return this.backgroundProcesses.get(processId);
  }
  
  /**
   * コマンド文字列をパース
   */
  private parseCommandString(commandStr: string): string[] {
    // シンプルな実装（より複雑なパースが必要な場合は shell-quote などを使用）
    return commandStr.split(/\s+/);
  }
}