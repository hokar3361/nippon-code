import { Message, CompletionOptions } from '../providers/base';
import { ProviderFactory } from '../providers';
import { config } from '../config';
import { ProjectAnalyzer } from '../analyzers/project';
// import { readFile } from '../utils/files';

export interface Context {
  type: 'file' | 'directory' | 'code' | 'system';
  path?: string;
  name?: string;
  content: string;
}

export interface Session {
  id: string;
  name: string;
  messages: Message[];
  contexts: Context[];
  metadata: {
    createdAt: Date;
    updatedAt: Date;
    model?: string;
    totalTokens?: number;
  };
}

export class ChatAgent {
  private session: Session;
  private provider = ProviderFactory.getProvider();
  private streaming: boolean = true;
  private systemPrompt: string;

  constructor(session: Session) {
    this.session = session;
    this.streaming = config.get('streaming');
    this.systemPrompt = this.buildSystemPrompt();
  }

  private buildSystemPrompt(): string {
    const lang = config.get('language');
    
    if (lang === 'ja') {
      return `あなたは高性能なコーディングアシスタント「VLLMCode」です。
以下の特徴を持っています：
- 正確で効率的なコードの生成
- バグの発見と修正の提案
- ベストプラクティスに基づいたアドバイス
- 明確で理解しやすい説明
- プロジェクト全体のコンテキストを考慮した提案

ユーザーを助けるため、以下のガイドラインに従ってください：
1. コードは完全で実行可能な形で提供する
2. 重要な変更点は明確に説明する
3. 潜在的な問題やリスクは事前に警告する
4. 質問には具体的で実践的な回答をする
5. 必要に応じて複数の解決策を提示する`;
    } else {
      return `You are VLLMCode, a high-performance coding assistant.
You have the following capabilities:
- Generate accurate and efficient code
- Identify and suggest bug fixes
- Provide best practice advice
- Give clear and understandable explanations
- Consider the entire project context

Follow these guidelines:
1. Provide complete, executable code
2. Clearly explain important changes
3. Warn about potential issues and risks
4. Give specific and practical answers
5. Present multiple solutions when appropriate`;
    }
  }

  public async chat(message: string): Promise<string> {
    // メッセージを履歴に追加
    this.addMessage('user', message);

    // コンテキストを含むメッセージを構築
    const messages = this.buildMessages();

    // AIプロバイダーに送信
    const options: CompletionOptions = {
      messages,
      model: config.get('model'),
      temperature: config.get('temperature'),
      maxTokens: config.get('maxTokens'),
      stream: false,
    };

    const response = await this.provider.complete(options);
    
    // レスポンスを履歴に追加
    this.addMessage('assistant', response.content);

    // トークン使用量を記録
    if (response.usage) {
      this.session.metadata.totalTokens = 
        (this.session.metadata.totalTokens || 0) + response.usage.totalTokens;
    }

    return response.content;
  }

  public async *streamChat(message: string): AsyncGenerator<string, void, unknown> {
    // メッセージを履歴に追加
    this.addMessage('user', message);

    // コンテキストを含むメッセージを構築
    const messages = this.buildMessages();

    // AIプロバイダーに送信
    const options: CompletionOptions = {
      messages,
      model: config.get('model'),
      temperature: config.get('temperature'),
      maxTokens: config.get('maxTokens'),
      stream: true,
    };

    let fullResponse = '';
    
    for await (const chunk of this.provider.streamComplete(options)) {
      if (!chunk.done && chunk.content) {
        fullResponse += chunk.content;
        yield chunk.content;
      }
    }

    // 完全なレスポンスを履歴に追加
    this.addMessage('assistant', fullResponse);
  }

  private buildMessages(): Message[] {
    const messages: Message[] = [];

    // システムプロンプト
    messages.push({
      role: 'system',
      content: this.systemPrompt,
    });

    // コンテキストをシステムメッセージとして追加
    if (this.session.contexts.length > 0) {
      const contextContent = this.buildContextContent();
      messages.push({
        role: 'system',
        content: contextContent,
      });
    }

    // 会話履歴を追加（最大コンテキスト長を考慮）
    const maxTokens = this.provider.getMaxTokens();
    const reservedTokens = config.get('maxTokens'); // 出力用に予約
    const availableTokens = maxTokens - reservedTokens;

    let currentTokens = this.provider.estimateTokens(this.systemPrompt);
    if (this.session.contexts.length > 0) {
      currentTokens += this.provider.estimateTokens(this.buildContextContent());
    }

    // 新しいメッセージから順に追加
    const historyMessages = [...this.session.messages].reverse();
    const includedMessages: Message[] = [];

    for (const msg of historyMessages) {
      const msgTokens = this.provider.estimateTokens(msg.content);
      if (currentTokens + msgTokens > availableTokens) {
        break;
      }
      includedMessages.unshift(msg);
      currentTokens += msgTokens;
    }

    messages.push(...includedMessages);

    return messages;
  }

  private buildContextContent(): string {
    const contextParts: string[] = ['=== コンテキスト ==='];

    for (const context of this.session.contexts) {
      switch (context.type) {
        case 'file':
          contextParts.push(`\n[ファイル: ${context.path}]\n${context.content}`);
          break;
        case 'directory':
          contextParts.push(`\n[ディレクトリ構造: ${context.path}]\n${context.content}`);
          break;
        case 'code':
          contextParts.push(`\n[コード分析: ${context.name}]\n${context.content}`);
          break;
        case 'system':
          contextParts.push(`\n[システム情報]\n${context.content}`);
          break;
      }
    }

    return contextParts.join('\n');
  }

  public addMessage(role: 'user' | 'assistant', content: string): void {
    this.session.messages.push({ role, content });
    this.session.metadata.updatedAt = new Date();
  }

  public addContext(context: Context): void {
    // 既存のコンテキストを更新または追加
    const existingIndex = this.session.contexts.findIndex(
      c => c.type === context.type && c.path === context.path
    );

    if (existingIndex >= 0) {
      this.session.contexts[existingIndex] = context;
    } else {
      this.session.contexts.push(context);
    }

    this.session.metadata.updatedAt = new Date();
  }

  public async analyzeDirectory(dirPath: string): Promise<void> {
    const analyzer = new ProjectAnalyzer();
    const analysis = await analyzer.analyzeDirectory(dirPath, {
      depth: config.get('analysisDepth'),
      includeStructure: true,
      includeDependencies: true,
    });

    this.addContext({
      type: 'directory',
      path: dirPath,
      content: JSON.stringify(analysis, null, 2),
    });
  }

  public clearHistory(): void {
    this.session.messages = [];
    this.session.metadata.updatedAt = new Date();
  }

  public clearContexts(): void {
    this.session.contexts = [];
    this.session.metadata.updatedAt = new Date();
  }

  public getHistory(): Message[] {
    return [...this.session.messages];
  }

  public getContexts(): Context[] {
    return [...this.session.contexts];
  }

  public isStreaming(): boolean {
    return this.streaming;
  }

  public setStreaming(enabled: boolean): void {
    this.streaming = enabled;
  }

  public getSession(): Session {
    return this.session;
  }

  public getTokenUsage(): number {
    return this.session.metadata.totalTokens || 0;
  }
}

