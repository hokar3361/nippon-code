// import { Readable } from 'stream';

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionOptions {
  messages: Message[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  stopSequences?: string[];
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
}

export interface CompletionResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model?: string;
  finishReason?: string;
}

export interface StreamChunk {
  content: string;
  done: boolean;
}

export abstract class AIProvider {
  protected apiKey: string;
  protected baseUrl: string;
  protected model: string;

  constructor(apiKey: string, baseUrl: string, model: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.model = model;
  }

  abstract complete(options: CompletionOptions): Promise<CompletionResponse>;
  abstract streamComplete(options: CompletionOptions): AsyncGenerator<StreamChunk, void, unknown>;
  
  // トークン数の推定
  abstract estimateTokens(text: string): number;
  
  // モデルの最大トークン数を取得
  abstract getMaxTokens(): number;
  
  // プロバイダー名を取得
  abstract getName(): string;
  
  // 利用可能なモデルのリストを取得
  abstract getAvailableModels(): Promise<string[]>;
  
  // ヘルスチェック
  abstract healthCheck(): Promise<boolean>;
}

