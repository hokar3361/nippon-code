import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';

export interface FileOperation {
  type: 'create' | 'update' | 'delete' | 'rename' | 'copy';
  path: string;
  content?: string;
  newPath?: string;
  backup?: boolean;
}

export interface FileOperationResult {
  success: boolean;
  operation: FileOperation;
  message: string;
  error?: Error;
  backupPath?: string;
}

export class FileOperations {
  private backupDir: string;
  private dryRun: boolean;

  constructor(options: { backupDir?: string; dryRun?: boolean } = {}) {
    this.backupDir = options.backupDir || path.join(process.cwd(), '.nippon-backup');
    this.dryRun = options.dryRun || false;
  }

  async executeOperation(operation: FileOperation): Promise<FileOperationResult> {
    try {
      // バックアップ処理
      if (operation.backup && existsSync(operation.path)) {
        const backupPath = await this.createBackup(operation.path);
        console.log(`📦 Backup created: ${backupPath}`);
      }

      // ドライランモード
      if (this.dryRun) {
        return {
          success: true,
          operation,
          message: `[DRY RUN] Would ${operation.type}: ${operation.path}`
        };
      }

      // 実際の操作実行
      switch (operation.type) {
        case 'create':
          return await this.createFile(operation);
        case 'update':
          return await this.updateFile(operation);
        case 'delete':
          return await this.deleteFile(operation);
        case 'rename':
          return await this.renameFile(operation);
        case 'copy':
          return await this.copyFile(operation);
        default:
          throw new Error(`Unknown operation type: ${operation.type}`);
      }
    } catch (error) {
      return {
        success: false,
        operation,
        message: `Failed to ${operation.type} ${operation.path}`,
        error: error as Error
      };
    }
  }

  private async createFile(operation: FileOperation): Promise<FileOperationResult> {
    const filePath = path.resolve(operation.path);
    const dir = path.dirname(filePath);

    // ディレクトリが存在しない場合は作成
    if (!existsSync(dir)) {
      await fs.mkdir(dir, { recursive: true });
      console.log(`📁 Created directory: ${dir}`);
    }

    // ファイルが既に存在する場合
    if (existsSync(filePath)) {
      return {
        success: false,
        operation,
        message: `File already exists: ${filePath}`,
        error: new Error('File already exists')
      };
    }

    // ファイル作成
    await fs.writeFile(filePath, operation.content || '', 'utf-8');
    
    return {
      success: true,
      operation,
      message: `✅ Created: ${filePath}`
    };
  }

  private async updateFile(operation: FileOperation): Promise<FileOperationResult> {
    const filePath = path.resolve(operation.path);

    // ファイルが存在しない場合
    if (!existsSync(filePath)) {
      return {
        success: false,
        operation,
        message: `File not found: ${filePath}`,
        error: new Error('File not found')
      };
    }

    // ファイル更新
    await fs.writeFile(filePath, operation.content || '', 'utf-8');
    
    return {
      success: true,
      operation,
      message: `✅ Updated: ${filePath}`
    };
  }

  private async deleteFile(operation: FileOperation): Promise<FileOperationResult> {
    const filePath = path.resolve(operation.path);

    // ファイルが存在しない場合
    if (!existsSync(filePath)) {
      return {
        success: false,
        operation,
        message: `File not found: ${filePath}`,
        error: new Error('File not found')
      };
    }

    // ファイル削除
    const stats = await fs.stat(filePath);
    if (stats.isDirectory()) {
      await fs.rm(filePath, { recursive: true, force: true });
    } else {
      await fs.unlink(filePath);
    }
    
    return {
      success: true,
      operation,
      message: `🗑️ Deleted: ${filePath}`
    };
  }

  private async renameFile(operation: FileOperation): Promise<FileOperationResult> {
    const oldPath = path.resolve(operation.path);
    const newPath = path.resolve(operation.newPath!);

    // ファイルが存在しない場合
    if (!existsSync(oldPath)) {
      return {
        success: false,
        operation,
        message: `File not found: ${oldPath}`,
        error: new Error('File not found')
      };
    }

    // 新しいパスが既に存在する場合
    if (existsSync(newPath)) {
      return {
        success: false,
        operation,
        message: `Target already exists: ${newPath}`,
        error: new Error('Target already exists')
      };
    }

    // ディレクトリ作成（必要な場合）
    const newDir = path.dirname(newPath);
    if (!existsSync(newDir)) {
      await fs.mkdir(newDir, { recursive: true });
    }

    // リネーム実行
    await fs.rename(oldPath, newPath);
    
    return {
      success: true,
      operation,
      message: `✏️ Renamed: ${oldPath} → ${newPath}`
    };
  }

  private async copyFile(operation: FileOperation): Promise<FileOperationResult> {
    const srcPath = path.resolve(operation.path);
    const destPath = path.resolve(operation.newPath!);

    // ソースファイルが存在しない場合
    if (!existsSync(srcPath)) {
      return {
        success: false,
        operation,
        message: `Source file not found: ${srcPath}`,
        error: new Error('Source file not found')
      };
    }

    // ディレクトリ作成（必要な場合）
    const destDir = path.dirname(destPath);
    if (!existsSync(destDir)) {
      await fs.mkdir(destDir, { recursive: true });
    }

    // コピー実行
    await fs.copyFile(srcPath, destPath);
    
    return {
      success: true,
      operation,
      message: `📋 Copied: ${srcPath} → ${destPath}`
    };
  }

  private async createBackup(filePath: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = path.basename(filePath);
    const backupPath = path.join(this.backupDir, timestamp, fileName);
    const backupDir = path.dirname(backupPath);

    // バックアップディレクトリ作成
    if (!existsSync(backupDir)) {
      await fs.mkdir(backupDir, { recursive: true });
    }

    // ファイルをバックアップ
    await fs.copyFile(filePath, backupPath);
    
    return backupPath;
  }

  async executeBatch(operations: FileOperation[]): Promise<FileOperationResult[]> {
    const results: FileOperationResult[] = [];
    
    for (const operation of operations) {
      const result = await this.executeOperation(operation);
      results.push(result);
      
      // エラーが発生した場合、後続の操作を中止するか？
      if (!result.success && !this.dryRun) {
        console.error(`❌ Operation failed: ${result.message}`);
        // オプション: ここで中断するか、続行するか選択可能
      }
    }
    
    return results;
  }

  async readFile(filePath: string): Promise<string> {
    const resolvedPath = path.resolve(filePath);
    
    if (!existsSync(resolvedPath)) {
      throw new Error(`File not found: ${resolvedPath}`);
    }
    
    return await fs.readFile(resolvedPath, 'utf-8');
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const resolvedPath = path.resolve(filePath);
    const dir = path.dirname(resolvedPath);
    
    // ディレクトリが存在しない場合は作成
    if (!existsSync(dir)) {
      await fs.mkdir(dir, { recursive: true });
    }
    
    await fs.writeFile(resolvedPath, content, 'utf-8');
  }

  async exists(filePath: string): Promise<boolean> {
    return existsSync(path.resolve(filePath));
  }

  async listDirectory(dirPath: string): Promise<string[]> {
    const resolvedPath = path.resolve(dirPath);
    
    if (!existsSync(resolvedPath)) {
      throw new Error(`Directory not found: ${resolvedPath}`);
    }
    
    const entries = await fs.readdir(resolvedPath, { withFileTypes: true });
    return entries.map(entry => {
      const type = entry.isDirectory() ? '📁' : '📄';
      return `${type} ${entry.name}`;
    });
  }

  async getFileInfo(filePath: string): Promise<{
    exists: boolean;
    size?: number;
    modified?: Date;
    isDirectory?: boolean;
  }> {
    const resolvedPath = path.resolve(filePath);
    
    if (!existsSync(resolvedPath)) {
      return { exists: false };
    }
    
    const stats = await fs.stat(resolvedPath);
    return {
      exists: true,
      size: stats.size,
      modified: stats.mtime,
      isDirectory: stats.isDirectory()
    };
  }

  setDryRun(enabled: boolean): void {
    this.dryRun = enabled;
  }

  getDryRun(): boolean {
    return this.dryRun;
  }
}

export const fileOperations = new FileOperations();