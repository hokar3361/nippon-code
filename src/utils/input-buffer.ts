import { EventEmitter } from 'events';

/**
 * 入力バッファリングシステム
 * 分割された入力を結合し、完全なメッセージを再構築する
 */
export class InputBuffer extends EventEmitter {
  private buffer: string[] = [];
  private lastInputTime: number = 0;
  private mergeTimeout: NodeJS.Timeout | null = null;
  private readonly MERGE_DELAY = 50; // 50ms以内の入力は結合対象
  private readonly MAX_BUFFER_SIZE = 100; // 最大バッファサイズ
  
  constructor() {
    super();
  }
  
  /**
   * 入力を追加
   * @param input 入力文字列
   * @param forceFlush 強制的にフラッシュするか
   */
  public addInput(input: string, forceFlush: boolean = false): void {
    const now = Date.now();
    const timeDiff = now - this.lastInputTime;
    
    // バッファサイズチェック
    if (this.buffer.length >= this.MAX_BUFFER_SIZE) {
      this.flush();
    }
    
    // 時間差チェック - 短時間の連続入力は結合対象
    if (timeDiff < this.MERGE_DELAY && this.buffer.length > 0) {
      // 連続入力として扱う
      this.buffer.push(input);
      this.resetMergeTimeout();
    } else if (this.buffer.length === 0) {
      // 新規入力
      this.buffer.push(input);
      this.resetMergeTimeout();
    } else {
      // 時間が経過した場合は前のバッファをフラッシュ
      this.flush();
      this.buffer.push(input);
      this.resetMergeTimeout();
    }
    
    this.lastInputTime = now;
    
    // 強制フラッシュ
    if (forceFlush) {
      this.flush();
    }
  }
  
  /**
   * エラーメッセージかどうかを判定
   */
  private isErrorMessage(text: string): boolean {
    const errorPatterns = [
      /error:/i,
      /exception:/i,
      /traceback/i,
      /failed/i,
      /cannot/i,
      /unable to/i,
      /not found/i,
      /internal server error/i,
      /stack trace/i,
      /at .+:\d+:\d+/,  // スタックトレースのパターン
      /^\s+at\s+/,       // スタックトレースの継続行
      /File ".+", line \d+/,  // Pythonのエラー
    ];
    
    return errorPatterns.some(pattern => pattern.test(text));
  }
  
  /**
   * 複数行メッセージの一部かどうかを判定
   */
  private isMultilinePart(text: string): boolean {
    // インデントで始まる行
    if (/^\s+/.test(text)) {
      return true;
    }
    
    // 継続を示すパターン
    const continuationPatterns = [
      /^\.\.\./,      // Python REPL style
      /^>/,           // 引用符
      /^\|/,          // パイプ文字
      /^-\s/,         // リスト項目
      /^\d+\.\s/,     // 番号付きリスト
      /^```/,         // コードブロック
    ];
    
    return continuationPatterns.some(pattern => pattern.test(text));
  }
  
  /**
   * バッファの内容が関連しているかチェック
   */
  private isRelatedContent(): boolean {
    if (this.buffer.length < 2) {
      return false;
    }
    
    // 全てがエラーメッセージの一部
    const allErrors = this.buffer.every(line => 
      this.isErrorMessage(line) || this.isMultilinePart(line)
    );
    
    if (allErrors) {
      return true;
    }
    
    // コードブロックのチェック
    const hasCodeBlockStart = this.buffer.some(line => line.includes('```'));
    const hasCodeBlockEnd = this.buffer.some(line => line.trim() === '```');
    
    if (hasCodeBlockStart || hasCodeBlockEnd) {
      return true;
    }
    
    // 連続したインデント
    const allIndented = this.buffer.slice(1).every(line => 
      this.isMultilinePart(line)
    );
    
    return allIndented;
  }
  
  /**
   * マージタイムアウトをリセット
   */
  private resetMergeTimeout(): void {
    if (this.mergeTimeout) {
      clearTimeout(this.mergeTimeout);
    }
    
    this.mergeTimeout = setTimeout(() => {
      this.flush();
    }, this.MERGE_DELAY * 2);
  }
  
  /**
   * バッファをフラッシュして結合されたメッセージを出力
   */
  public flush(): void {
    if (this.mergeTimeout) {
      clearTimeout(this.mergeTimeout);
      this.mergeTimeout = null;
    }
    
    if (this.buffer.length === 0) {
      return;
    }
    
    // 関連コンテンツは結合、そうでなければ個別に処理
    if (this.isRelatedContent()) {
      const merged = this.buffer.join('\n');
      this.emit('message', merged);
    } else {
      // 個別に処理
      this.buffer.forEach(line => {
        this.emit('message', line);
      });
    }
    
    this.buffer = [];
  }
  
  /**
   * バッファをクリア
   */
  public clear(): void {
    if (this.mergeTimeout) {
      clearTimeout(this.mergeTimeout);
      this.mergeTimeout = null;
    }
    this.buffer = [];
    this.lastInputTime = 0;
  }
  
  /**
   * 現在のバッファサイズを取得
   */
  public getBufferSize(): number {
    return this.buffer.length;
  }
  
  /**
   * ペースト検出ヒューリスティック
   * 複数行が極めて短時間に入力された場合はペーストと判定
   */
  public isProbablyPaste(lineCount: number, timeSpan: number): boolean {
    // 3行以上が10ms以内に入力された場合はペーストの可能性が高い
    return lineCount >= 3 && timeSpan < 10;
  }
}