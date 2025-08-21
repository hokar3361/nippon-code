import { spawn, exec, SpawnOptions } from 'child_process';
import { promisify } from 'util';
import { platformDetector } from '../utils/platform-detector';
import * as path from 'path';

const execAsync = promisify(exec);

export interface CommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeout?: number;
  shell?: boolean | string;
  encoding?: BufferEncoding;
  maxBuffer?: number;
  silent?: boolean;
  dryRun?: boolean;
}

export interface CommandResult {
  success: boolean;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error?: Error;
  duration: number;
}

export interface StreamingCommandOptions extends CommandOptions {
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
  onExit?: (code: number | null) => void;
}

export class CommandRunner {
  private defaultOptions: CommandOptions;
  private runningProcesses: Map<string, any> = new Map();

  constructor(defaultOptions: CommandOptions = {}) {
    this.defaultOptions = {
      cwd: process.cwd(),
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024 * 10, // 10MB
      timeout: 60000, // 60秒
      shell: true,
      ...defaultOptions
    };
  }

  async run(command: string, options: CommandOptions = {}): Promise<CommandResult> {
    const startTime = Date.now();
    const opts = { ...this.defaultOptions, ...options };
    
    // プラットフォーム固有のコマンド正規化
    const normalizedCommand = platformDetector.normalizeCommand(command);
    
    // ドライランモード
    if (opts.dryRun) {
      return {
        success: true,
        command: normalizedCommand,
        stdout: `[DRY RUN] Would execute: ${normalizedCommand}`,
        stderr: '',
        exitCode: 0,
        duration: 0
      };
    }

    if (!opts.silent) {
      console.log(`🚀 Running: ${normalizedCommand}`);
    }

    try {
      const { stdout, stderr } = await execAsync(normalizedCommand, {
        cwd: opts.cwd,
        env: { ...process.env, ...opts.env },
        encoding: opts.encoding as BufferEncoding,
        timeout: opts.timeout,
        maxBuffer: opts.maxBuffer,
        shell: opts.shell as any
      });

      const duration = Date.now() - startTime;

      return {
        success: true,
        command: normalizedCommand,
        stdout: stdout || '',
        stderr: stderr || '',
        exitCode: 0,
        duration
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      return {
        success: false,
        command: normalizedCommand,
        stdout: error.stdout || '',
        stderr: error.stderr || error.message,
        exitCode: error.code || 1,
        error,
        duration
      };
    }
  }

  async runStreaming(
    command: string, 
    options: StreamingCommandOptions = {}
  ): Promise<CommandResult> {
    const startTime = Date.now();
    const opts = { ...this.defaultOptions, ...options };
    
    // プラットフォーム固有のコマンド正規化
    const normalizedCommand = platformDetector.normalizeCommand(command);
    
    // ドライランモード
    if (opts.dryRun) {
      if (opts.onStdout) {
        opts.onStdout(`[DRY RUN] Would execute: ${normalizedCommand}\n`);
      }
      return {
        success: true,
        command: normalizedCommand,
        stdout: `[DRY RUN] Would execute: ${normalizedCommand}`,
        stderr: '',
        exitCode: 0,
        duration: 0
      };
    }

    return new Promise((resolve) => {
      const isWindows = platformDetector.isWindows();
      const shell = opts.shell === true 
        ? (isWindows ? 'cmd.exe' : '/bin/bash')
        : opts.shell || undefined;

      const spawnOptions: SpawnOptions = {
        cwd: opts.cwd,
        env: { ...process.env, ...opts.env },
        shell: shell as any,
        windowsHide: true
      };

      // Windowsの場合、cmd.exeを使用
      let cmd: string;
      let args: string[];
      
      if (isWindows && opts.shell) {
        cmd = 'cmd.exe';
        args = ['/c', normalizedCommand];
      } else {
        cmd = normalizedCommand;
        args = [];
      }

      const child = spawn(cmd, args, spawnOptions);
      
      let stdout = '';
      let stderr = '';
      let killed = false;

      // タイムアウト処理
      const timeout = opts.timeout ? setTimeout(() => {
        killed = true;
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL');
          }
        }, 5000);
      }, opts.timeout) : null;

      // 標準出力処理
      child.stdout?.on('data', (data: Buffer) => {
        const text = data.toString(opts.encoding || 'utf-8');
        stdout += text;
        if (opts.onStdout) {
          opts.onStdout(text);
        }
      });

      // 標準エラー出力処理
      child.stderr?.on('data', (data: Buffer) => {
        const text = data.toString(opts.encoding || 'utf-8');
        stderr += text;
        if (opts.onStderr) {
          opts.onStderr(text);
        }
      });

      // プロセス終了処理
      child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
        if (timeout) clearTimeout(timeout);
        
        const duration = Date.now() - startTime;
        const exitCode = code ?? (signal ? 1 : 0);
        
        if (opts.onExit) {
          opts.onExit(exitCode);
        }

        const result: CommandResult = {
          success: exitCode === 0 && !killed,
          command: normalizedCommand,
          stdout,
          stderr,
          exitCode,
          duration
        };

        if (killed) {
          result.error = new Error(`Command timed out after ${opts.timeout}ms`);
        }

        resolve(result);
      });

      // エラー処理
      child.on('error', (error: Error) => {
        if (timeout) clearTimeout(timeout);
        
        const duration = Date.now() - startTime;
        
        resolve({
          success: false,
          command: normalizedCommand,
          stdout,
          stderr: error.message,
          exitCode: 1,
          error,
          duration
        });
      });

      // プロセスを記録（後でキャンセル可能にするため）
      const processId = `${Date.now()}-${Math.random()}`;
      this.runningProcesses.set(processId, child);
      
      child.on('exit', () => {
        this.runningProcesses.delete(processId);
      });
    });
  }

  async runSequence(commands: string[], options: CommandOptions = {}): Promise<CommandResult[]> {
    const results: CommandResult[] = [];
    
    for (const command of commands) {
      const result = await this.run(command, options);
      results.push(result);
      
      // エラーが発生した場合、後続のコマンドを実行しない
      if (!result.success && !options.dryRun) {
        console.error(`❌ Command failed: ${command}`);
        break;
      }
    }
    
    return results;
  }

  async runParallel(commands: string[], options: CommandOptions = {}): Promise<CommandResult[]> {
    const promises = commands.map(command => this.run(command, options));
    return await Promise.all(promises);
  }

  async runScript(scriptPath: string, args: string[] = [], options: CommandOptions = {}): Promise<CommandResult> {
    const extension = path.extname(scriptPath).toLowerCase();
    let command: string;

    switch (extension) {
      case '.js':
      case '.mjs':
        command = `node ${scriptPath} ${args.join(' ')}`;
        break;
      case '.ts':
        command = `npx ts-node ${scriptPath} ${args.join(' ')}`;
        break;
      case '.py':
        command = `${platformDetector.isWindows() ? 'python' : 'python3'} ${scriptPath} ${args.join(' ')}`;
        break;
      case '.sh':
        if (platformDetector.isWindows()) {
          command = `bash ${scriptPath} ${args.join(' ')}`;
        } else {
          command = `sh ${scriptPath} ${args.join(' ')}`;
        }
        break;
      case '.bat':
      case '.cmd':
        if (!platformDetector.isWindows()) {
          throw new Error('Cannot run .bat/.cmd files on non-Windows systems');
        }
        command = `${scriptPath} ${args.join(' ')}`;
        break;
      default:
        command = `${scriptPath} ${args.join(' ')}`;
    }

    return await this.run(command, options);
  }

  async checkCommand(command: string): Promise<boolean> {
    try {
      const result = await this.run(`${platformDetector.isWindows() ? 'where' : 'which'} ${command}`, {
        silent: true
      });
      return result.success;
    } catch {
      return false;
    }
  }

  async installDependencies(packageManager: 'npm' | 'yarn' | 'pnpm' = 'npm', options: CommandOptions = {}): Promise<CommandResult> {
    const commands = {
      npm: 'npm install',
      yarn: 'yarn install',
      pnpm: 'pnpm install'
    };

    const command = commands[packageManager];
    
    if (!options.silent) {
      console.log(`📦 Installing dependencies with ${packageManager}...`);
    }

    return await this.runStreaming(command, {
      ...options,
      onStdout: (data) => {
        if (!options.silent) {
          process.stdout.write(data);
        }
      }
    });
  }

  async runTests(testCommand?: string, options: CommandOptions = {}): Promise<CommandResult> {
    const command = testCommand || 'npm test';
    
    if (!options.silent) {
      console.log(`🧪 Running tests...`);
    }

    return await this.runStreaming(command, {
      ...options,
      onStdout: (data) => {
        if (!options.silent) {
          process.stdout.write(data);
        }
      }
    });
  }

  async build(buildCommand?: string, options: CommandOptions = {}): Promise<CommandResult> {
    const command = buildCommand || 'npm run build';
    
    if (!options.silent) {
      console.log(`🔨 Building project...`);
    }

    return await this.runStreaming(command, {
      ...options,
      onStdout: (data) => {
        if (!options.silent) {
          process.stdout.write(data);
        }
      }
    });
  }

  killAll(): void {
    this.runningProcesses.forEach((child) => {
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }, 5000);
    });
    this.runningProcesses.clear();
  }

  setDryRun(enabled: boolean): void {
    this.defaultOptions.dryRun = enabled;
  }

  getDryRun(): boolean {
    return this.defaultOptions.dryRun || false;
  }
}

export const commandRunner = new CommandRunner();