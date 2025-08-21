import * as os from 'os';

export interface PlatformInfo {
  os: 'windows' | 'mac' | 'linux';
  arch: string;
  node: string;
  npm: string;
  shell: string;
  homeDir: string;
  tempDir: string;
  pathSeparator: string;
  hasDocker: boolean;
  hasGit: boolean;
  hasPython: boolean;
  hasNode: boolean;
}

export interface CommandAdapter {
  listFiles: string;
  createDir: string;
  removeDir: string;
  copyFile: string;
  moveFile: string;
  deleteFile: string;
  readFile: string;
  writeFile: string;
  changeDir: string;
  currentDir: string;
  envVar: (name: string) => string;
  setEnvVar: (name: string, value: string) => string;
  runScript: (script: string) => string;
  chainCommands: (...commands: string[]) => string;
  backgroundTask: (command: string) => string;
  killProcess: (pid: string) => string;
}

export class PlatformDetector {
  private static instance: PlatformDetector;
  private platformInfo: PlatformInfo | null = null;

  private constructor() {}

  static getInstance(): PlatformDetector {
    if (!PlatformDetector.instance) {
      PlatformDetector.instance = new PlatformDetector();
    }
    return PlatformDetector.instance;
  }

  async detect(): Promise<PlatformInfo> {
    if (this.platformInfo) {
      return this.platformInfo;
    }

    const platform = os.platform();
    let osType: 'windows' | 'mac' | 'linux';
    
    switch (platform) {
      case 'win32':
        osType = 'windows';
        break;
      case 'darwin':
        osType = 'mac';
        break;
      default:
        osType = 'linux';
    }

    this.platformInfo = {
      os: osType,
      arch: os.arch(),
      node: process.version,
      npm: await this.getNpmVersion(),
      shell: this.getDefaultShell(osType),
      homeDir: os.homedir(),
      tempDir: os.tmpdir(),
      pathSeparator: osType === 'windows' ? '\\' : '/',
      hasDocker: await this.checkCommand('docker --version'),
      hasGit: await this.checkCommand('git --version'),
      hasPython: await this.checkCommand(osType === 'windows' ? 'python --version' : 'python3 --version'),
      hasNode: true
    };

    return this.platformInfo;
  }

  getCommandAdapter(): CommandAdapter {
    const info = this.platformInfo || { os: 'linux' as const };
    const isWindows = info.os === 'windows';

    return {
      listFiles: isWindows ? 'dir' : 'ls -la',
      createDir: isWindows ? 'mkdir' : 'mkdir -p',
      removeDir: isWindows ? 'rmdir /s /q' : 'rm -rf',
      copyFile: isWindows ? 'copy' : 'cp',
      moveFile: isWindows ? 'move' : 'mv',
      deleteFile: isWindows ? 'del' : 'rm',
      readFile: isWindows ? 'type' : 'cat',
      writeFile: isWindows ? 'echo >' : 'echo >',
      changeDir: 'cd',
      currentDir: isWindows ? 'cd' : 'pwd',
      envVar: (name: string) => isWindows ? `%${name}%` : `$${name}`,
      setEnvVar: (name: string, value: string) => 
        isWindows ? `set ${name}=${value}` : `export ${name}="${value}"`,
      runScript: (script: string) => 
        isWindows ? `cmd /c "${script}"` : `bash -c "${script}"`,
      chainCommands: (...commands: string[]) => 
        commands.join(isWindows ? ' && ' : ' && '),
      backgroundTask: (command: string) => 
        isWindows ? `start /b ${command}` : `${command} &`,
      killProcess: (pid: string) => 
        isWindows ? `taskkill /PID ${pid} /F` : `kill -9 ${pid}`
    };
  }

  normalizeCommand(command: string): string {
    const info = this.platformInfo || { os: 'linux' as const };
    const isWindows = info.os === 'windows';

    // npm/npxコマンドの正規化
    if (command.startsWith('npm ') || command.startsWith('npx ')) {
      // Windowsでは.cmdを追加する場合がある
      if (isWindows && !command.includes('.cmd')) {
        const parts = command.split(' ');
        if (parts[0] === 'npm' || parts[0] === 'npx') {
          // 通常はそのままで動作するが、念のため
          return command;
        }
      }
      return command;
    }

    // パス区切り文字の正規化
    if (isWindows) {
      command = command.replace(/\//g, '\\');
    } else {
      command = command.replace(/\\/g, '/');
    }

    // Python実行コマンドの正規化
    if (command.startsWith('python ')) {
      if (!isWindows) {
        command = command.replace(/^python /, 'python3 ');
      }
    }

    // シェルスクリプトの実行
    if (command.endsWith('.sh') && isWindows) {
      return `bash ${command}`;
    }
    if (command.endsWith('.bat') && !isWindows) {
      console.warn('Warning: .bat files cannot run on non-Windows systems');
      return `echo "Cannot run .bat file on ${info.os}"`;
    }

    return command;
  }

  getShellCommand(): string {
    const info = this.platformInfo || { os: 'linux' as const };
    
    switch (info.os) {
      case 'windows':
        return 'cmd.exe';
      case 'mac':
        return '/bin/zsh';
      default:
        return '/bin/bash';
    }
  }

  private getDefaultShell(osType: 'windows' | 'mac' | 'linux'): string {
    switch (osType) {
      case 'windows':
        return process.env.COMSPEC || 'cmd.exe';
      case 'mac':
        return process.env.SHELL || '/bin/zsh';
      default:
        return process.env.SHELL || '/bin/bash';
    }
  }

  private async getNpmVersion(): Promise<string> {
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);
      
      const { stdout } = await execAsync('npm --version');
      return stdout.trim();
    } catch {
      return 'unknown';
    }
  }

  private async checkCommand(command: string): Promise<boolean> {
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);
      
      await execAsync(command);
      return true;
    } catch {
      return false;
    }
  }

  isWindows(): boolean {
    return (this.platformInfo?.os || os.platform() === 'win32') === 'windows';
  }

  isMac(): boolean {
    return (this.platformInfo?.os || os.platform() === 'darwin') === 'mac';
  }

  isLinux(): boolean {
    const platform = this.platformInfo?.os || os.platform();
    return platform !== 'windows' && platform !== 'mac';
  }
}

export const platformDetector = PlatformDetector.getInstance();