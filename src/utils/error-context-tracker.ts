import { EventEmitter } from 'events';
import fs from 'fs-extra';
import path from 'path';

/**
 * エラーコンテキストの種類
 */
export interface ErrorContext {
  timestamp: Date;
  type: 'command' | 'file_creation' | 'api_call' | 'execution';
  operation: string;
  details: any;
  files?: string[];
  error?: Error | string;
}

/**
 * 自動修正提案
 */
export interface FixSuggestion {
  description: string;
  confidence: 'high' | 'medium' | 'low';
  action: () => Promise<void>;
}

/**
 * エラーコンテキストトラッカー
 * エラー発生時のコンテキストを追跡し、自動修正を提案する
 */
export class ErrorContextTracker extends EventEmitter {
  private contextHistory: ErrorContext[] = [];
  private createdFiles: Set<string> = new Set();
  private executedCommands: string[] = [];
  private readonly MAX_HISTORY = 50;
  
  constructor() {
    super();
  }
  
  /**
   * コンテキストを記録
   */
  public recordContext(context: ErrorContext): void {
    this.contextHistory.push(context);
    
    // ファイル作成の記録
    if (context.type === 'file_creation' && context.files) {
      context.files.forEach(file => this.createdFiles.add(file));
    }
    
    // コマンド実行の記録
    if (context.type === 'command' && context.operation) {
      this.executedCommands.push(context.operation);
    }
    
    // 履歴サイズ制限
    if (this.contextHistory.length > this.MAX_HISTORY) {
      this.contextHistory.shift();
    }
    
    this.emit('context:recorded', context);
  }
  
  /**
   * エラーを分析して修正提案を生成
   */
  public async analyzeError(error: string | Error): Promise<FixSuggestion[]> {
    const errorMessage = typeof error === 'string' ? error : error.message;
    const suggestions: FixSuggestion[] = [];
    
    // Pythonインポートエラー
    if (errorMessage.includes('ModuleNotFoundError') || errorMessage.includes('No module named')) {
      const moduleMatch = errorMessage.match(/No module named ['"](.+)['"]/);
      if (moduleMatch) {
        suggestions.push({
          description: `モジュール '${moduleMatch[1]}' をインストール: pip install ${moduleMatch[1]}`,
          confidence: 'high',
          action: async () => {
            this.emit('fix:execute', { command: `pip install ${moduleMatch[1]}` });
          }
        });
      }
    }
    
    // ファイルが見つからないエラー
    if (errorMessage.includes('FileNotFoundError') || errorMessage.includes('cannot find') || errorMessage.includes('not found')) {
      const fileMatch = errorMessage.match(/['"]([\w./\\-]+\.\w+)['"]/);
      if (fileMatch) {
        const fileName = fileMatch[1];
        
        // 最近作成したファイルをチェック
        const recentFile = Array.from(this.createdFiles).find(f => 
          path.basename(f) === path.basename(fileName)
        );
        
        if (recentFile) {
          suggestions.push({
            description: `ファイルパスを修正: ${fileName} → ${recentFile}`,
            confidence: 'high',
            action: async () => {
              this.emit('fix:path', { oldPath: fileName, newPath: recentFile });
            }
          });
        } else {
          suggestions.push({
            description: `不足しているファイル '${fileName}' を作成`,
            confidence: 'medium',
            action: async () => {
              this.emit('fix:create_file', { path: fileName });
            }
          });
        }
      }
    }
    
    // ポート使用中エラー
    if (errorMessage.includes('address already in use') || errorMessage.includes('port') && errorMessage.includes('in use')) {
      const portMatch = errorMessage.match(/:(\d+)/);
      const port = portMatch ? portMatch[1] : '5000';
      
      suggestions.push({
        description: `ポート ${port} を使用中のプロセスを終了`,
        confidence: 'high',
        action: async () => {
          this.emit('fix:kill_port', { port });
        }
      });
      
      suggestions.push({
        description: `別のポートを使用`,
        confidence: 'medium',
        action: async () => {
          this.emit('fix:change_port', { currentPort: port, newPort: String(parseInt(port) + 1) });
        }
      });
    }
    
    // 構文エラー
    if (errorMessage.includes('SyntaxError') || errorMessage.includes('IndentationError')) {
      const lineMatch = errorMessage.match(/line (\d+)/);
      const fileMatch = errorMessage.match(/File ["'](.+?)["']/);
      
      if (fileMatch && lineMatch) {
        suggestions.push({
          description: `${fileMatch[1]} の ${lineMatch[1]} 行目の構文エラーを修正`,
          confidence: 'medium',
          action: async () => {
            this.emit('fix:syntax', { file: fileMatch[1], line: parseInt(lineMatch[1]) });
          }
        });
      }
    }
    
    // 権限エラー
    if (errorMessage.includes('Permission denied') || errorMessage.includes('Access denied')) {
      suggestions.push({
        description: '管理者権限で再実行',
        confidence: 'medium',
        action: async () => {
          const lastCommand = this.executedCommands[this.executedCommands.length - 1];
          if (lastCommand) {
            this.emit('fix:elevate', { command: lastCommand });
          }
        }
      });
    }
    
    // 依存関係エラー
    if (errorMessage.includes('requirements.txt')) {
      suggestions.push({
        description: '依存関係をインストール: pip install -r requirements.txt',
        confidence: 'high',
        action: async () => {
          this.emit('fix:execute', { command: 'pip install -r requirements.txt' });
        }
      });
    }
    
    // Node.js依存関係エラー
    if (errorMessage.includes('Cannot find module') || errorMessage.includes('MODULE_NOT_FOUND')) {
      suggestions.push({
        description: 'npm install を実行して依存関係をインストール',
        confidence: 'high',
        action: async () => {
          this.emit('fix:execute', { command: 'npm install' });
        }
      });
    }
    
    return suggestions;
  }
  
  /**
   * 最近のコンテキストを取得
   */
  public getRecentContext(count: number = 5): ErrorContext[] {
    return this.contextHistory.slice(-count);
  }
  
  /**
   * 作成されたファイルのリストを取得
   */
  public getCreatedFiles(): string[] {
    return Array.from(this.createdFiles);
  }
  
  /**
   * 実行されたコマンドのリストを取得
   */
  public getExecutedCommands(): string[] {
    return [...this.executedCommands];
  }
  
  /**
   * エラーが関連ファイルに関するものかチェック
   */
  public isRelatedToCreatedFiles(error: string): boolean {
    const errorLower = error.toLowerCase();
    
    for (const file of this.createdFiles) {
      const fileName = path.basename(file);
      if (errorLower.includes(fileName.toLowerCase())) {
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * コンテキストをクリア
   */
  public clear(): void {
    this.contextHistory = [];
    this.createdFiles.clear();
    this.executedCommands = [];
  }
  
  /**
   * コンテキストを永続化
   */
  public async saveContext(filePath: string): Promise<void> {
    const data = {
      contextHistory: this.contextHistory,
      createdFiles: Array.from(this.createdFiles),
      executedCommands: this.executedCommands,
      timestamp: new Date().toISOString()
    };
    
    await fs.writeJson(filePath, data, { spaces: 2 });
  }
  
  /**
   * コンテキストを復元
   */
  public async loadContext(filePath: string): Promise<void> {
    if (!await fs.pathExists(filePath)) {
      return;
    }
    
    try {
      const data = await fs.readJson(filePath);
      this.contextHistory = data.contextHistory || [];
      this.createdFiles = new Set(data.createdFiles || []);
      this.executedCommands = data.executedCommands || [];
    } catch (error) {
      console.error('Failed to load context:', error);
    }
  }
}