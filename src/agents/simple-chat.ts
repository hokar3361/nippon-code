import { Message, CompletionOptions } from '../providers/base';
import { ProviderFactory } from '../providers';
import { config } from '../config';

export class SimpleChatAgent {
  private provider = ProviderFactory.getProvider();
  private messages: Message[] = [];
  private model: string;
  private streaming: boolean = true;

  constructor(model: string) {
    this.model = model;
    this.streaming = config.get('streaming');
    this.initializeSystemPrompt();
  }

  private initializeSystemPrompt(): void {
    const lang = config.get('language');
    
    const systemPrompt = lang === 'ja' 
      ? `あなたは高性能なコーディングアシスタント「NipponCode」です。
日本語と英語の両方に対応し、以下の特徴を持っています：
- 正確で効率的なコードの生成
- バグの特定と修正の提案
- コードレビューとリファクタリングの支援
- 技術的な質問への詳細な回答
- ベストプラクティスの提案`
      : `You are NipponCode, a high-performance coding assistant.
You have the following capabilities:
- Generate accurate and efficient code
- Identify bugs and suggest fixes
- Assist with code review and refactoring
- Provide detailed technical answers
- Suggest best practices`;

    this.messages.push({
      role: 'system',
      content: systemPrompt,
    });
  }

  public async chat(message: string): Promise<string> {
    // メッセージを追加
    this.messages.push({
      role: 'user',
      content: message,
    });

    const options: CompletionOptions = {
      model: this.model,
      messages: this.messages,
      temperature: config.get('temperature'),
      maxTokens: config.get('maxTokens'),
      stream: false,
    };

    try {
      const response = await this.provider.complete(options);
      
      // アシスタントの応答を履歴に追加
      this.messages.push({
        role: 'assistant',
        content: response.content,
      });

      return response.content;
    } catch (error: any) {
      throw new Error(`チャット中にエラーが発生しました: ${error.message}`);
    }
  }

  public async *streamChat(message: string): AsyncGenerator<string> {
    // メッセージを追加
    this.messages.push({
      role: 'user',
      content: message,
    });

    const options: CompletionOptions = {
      model: this.model,
      messages: this.messages,
      temperature: config.get('temperature'),
      maxTokens: config.get('maxTokens'),
      stream: true,
    };

    try {
      let fullResponse = '';
      
      for await (const chunk of this.provider.streamComplete(options)) {
        fullResponse += chunk.content;
        yield chunk.content;
      }

      // アシスタントの応答を履歴に追加
      this.messages.push({
        role: 'assistant',
        content: fullResponse,
      });
    } catch (error: any) {
      throw new Error(`ストリーミング中にエラーが発生しました: ${error.message}`);
    }
  }

  public getHistory(): Message[] {
    return [...this.messages];
  }

  public clearHistory(): void {
    this.messages = [];
    this.initializeSystemPrompt();
  }

  public isStreaming(): boolean {
    return this.streaming;
  }

  public setStreaming(value: boolean): void {
    this.streaming = value;
  }

  public addContext(context: { type: string; content: string; path?: string }): void {
    const contextMessage = `[${context.type.toUpperCase()}${context.path ? `: ${context.path}` : ''}]\n${context.content}`;
    this.messages.push({
      role: 'system',
      content: contextMessage,
    });
  }

  public async analyzeDirectory(dirPath: string): Promise<void> {
    // ディレクトリ分析のダミー実装
    this.addContext({
      type: 'directory',
      path: dirPath,
      content: `Directory ${dirPath} analyzed`,
    });
  }

  public getContexts(): any[] {
    return this.messages
      .filter(msg => msg.role === 'system')
      .map((msg, index) => ({
        type: 'system',
        content: msg.content,
        index,
      }));
  }
}