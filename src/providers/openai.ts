import axios, { AxiosInstance } from 'axios';
import { AIProvider, CompletionOptions, CompletionResponse, StreamChunk } from './base';
import { Tiktoken, encoding_for_model } from 'tiktoken';

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenAICompletionRequest {
  model: string;
  messages?: OpenAIMessage[];  // 旧API用
  input?: any;  // 新API用（文字列または配列）
  tools?: any[];  // ツール（web_search_preview等）
  temperature?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  stream?: boolean;
  stop?: string[];
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
}

interface OpenAICompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  output_text?: string;  // 新API用
  choices?: Array<{  // 旧API用
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class OpenAIProvider extends AIProvider {
  private client: AxiosInstance;
  private encoder: Tiktoken | null = null;

  constructor(apiKey: string, baseUrl: string = 'https://api.openai.com/v1', model: string = 'gpt-4-turbo-preview') {
    super(apiKey, baseUrl, model);
    
    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 120000, // 2分のタイムアウト
    });

    // エンコーダーの初期化
    try {
      this.encoder = encoding_for_model(model as any);
    } catch {
      // モデル固有のエンコーダーが利用できない場合は、汎用的なものを使用
      this.encoder = encoding_for_model('gpt-3.5-turbo');
    }
  }

  async complete(options: CompletionOptions): Promise<CompletionResponse> {
    const endpoint = '/chat/completions';
    
    // GPT-5も一旦通常のchat/completionsエンドポイントを使用
    const request: OpenAICompletionRequest = {
      model: options.model || this.model,
      messages: options.messages,
      temperature: this.model.includes('gpt-5') ? undefined : options.temperature,  // GPT-5ではtemperatureを送らない
      stream: false,
      stop: options.stopSequences,
      top_p: options.topP,
      frequency_penalty: options.frequencyPenalty,
      presence_penalty: options.presencePenalty,
    };
    
    // GPT-4o/GPT-5ではmax_completion_tokensを使用
    if (this.model.includes('gpt-5') || this.model.includes('gpt-4o')) {
      request.max_completion_tokens = options.maxTokens;
    } else {
      request.max_tokens = options.maxTokens;
    }

    try {
      const response = await this.client.post<OpenAICompletionResponse>(endpoint, request);
      const data = response.data;

      // レスポンス処理
      if (!data.choices || data.choices.length === 0) {
        throw new Error('No response from API');
      }
      const content = data.choices[0].message.content;
      const finishReason = data.choices[0].finish_reason;
      
      return {
        content,
        usage: data.usage ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        } : undefined,
        model: data.model,
        finishReason,
      };
    } catch (error: any) {
      if (error.response) {
        throw new Error(`API Error (${error.response.status}): ${error.response.data?.error?.message || error.message}`);
      }
      throw new Error(`Network Error: ${error.message}`);
    }
  }

  async *streamComplete(options: CompletionOptions): AsyncGenerator<StreamChunk, void, unknown> {
    const endpoint = '/chat/completions';  // 一旦旧APIを使用
    
    // GPT-5も一旦通常のchat/completionsエンドポイントを使用
    const request: OpenAICompletionRequest = {
      model: options.model || this.model,
      messages: options.messages,
      temperature: this.model.includes('gpt-5') ? undefined : options.temperature,  // GPT-5ではtemperatureを送らない
      stream: true,
      stop: options.stopSequences,
      top_p: options.topP,
      frequency_penalty: options.frequencyPenalty,
      presence_penalty: options.presencePenalty,
    };
    
    // GPT-4o/GPT-5ではmax_completion_tokensを使用
    if (this.model.includes('gpt-5') || this.model.includes('gpt-4o')) {
      request.max_completion_tokens = options.maxTokens;
    } else {
      request.max_tokens = options.maxTokens;
    }

    try {
      const response = await this.client.post(endpoint, request, {
        responseType: 'stream',
      });

      let buffer = '';
      
      for await (const chunk of response.data) {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim() === '') continue;
          if (line.trim() === 'data: [DONE]') {
            yield { content: '', done: true };
            return;
          }

          if (line.startsWith('data: ')) {
            try {
              const json = JSON.parse(line.slice(6));
              const content = json.choices?.[0]?.delta?.content || '';
              const finishReason = json.choices?.[0]?.finish_reason;
              
              if (content) {
                yield { content, done: false };
              }
              
              if (finishReason) {
                yield { content: '', done: true };
                return;
              }
            } catch (e) {
              console.error('Failed to parse SSE message:', line);
            }
          }
        }
      }
    } catch (error: any) {
      if (error.response) {
        throw new Error(`API Error (${error.response.status}): ${error.response.data?.error?.message || error.message}`);
      }
      throw new Error(`Network Error: ${error.message}`);
    }
  }

  estimateTokens(text: string): number {
    if (!this.encoder) {
      // エンコーダーが利用できない場合は簡易推定
      return Math.ceil(text.length / 4);
    }
    return this.encoder.encode(text).length;
  }

  getMaxTokens(): number {
    // モデルごとの最大トークン数
    const modelLimits: Record<string, number> = {
      'gpt-5': 128000,
      'gpt-5-mini': 128000,
      'gpt-4o': 128000,
      'gpt-4o-mini': 128000,
      'gpt-4-turbo-preview': 128000,
      'gpt-4-turbo': 128000,
      'gpt-4': 8192,
      'gpt-4-32k': 32768,
      'gpt-3.5-turbo': 16385,
      'gpt-3.5-turbo-16k': 16385,
    };

    return modelLimits[this.model] || 4096;
  }

  getName(): string {
    return 'OpenAI';
  }

  async getAvailableModels(): Promise<string[]> {
    try {
      const response = await this.client.get('/models');
      const models = response.data.data
        .filter((model: any) => model.id.includes('gpt'))
        .map((model: any) => model.id)
        .sort();
      return models;
    } catch (error) {
      console.error('Failed to fetch models:', error);
      return [
        'gpt-5',
        'gpt-5-mini',
        'gpt-4o',
        'gpt-4o-mini',
        'gpt-4-turbo-preview',
        'gpt-4',
        'gpt-3.5-turbo',
      ];
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.get('/models');
      return true;
    } catch {
      return false;
    }
  }
}

