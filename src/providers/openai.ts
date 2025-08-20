import OpenAI from 'openai';
import { AIProvider, CompletionOptions, CompletionResponse, StreamChunk } from './base';
import { Tiktoken, encoding_for_model } from 'tiktoken';

export class OpenAIProvider extends AIProvider {
  private client: OpenAI;
  private encoder: Tiktoken | null = null;

  constructor(apiKey: string, baseUrl: string = 'https://api.openai.com/v1', model: string = 'gpt-4-turbo-preview') {
    super(apiKey, baseUrl, model);
    
    this.client = new OpenAI({
      apiKey: this.apiKey,
      baseURL: this.baseUrl,
      timeout: 120000, // 2分のタイムアウト
      maxRetries: 2, // 自動リトライ2回
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
    try {
      const completion = await this.client.chat.completions.create({
        model: options.model || this.model,
        messages: options.messages || [],
        temperature: this.model.includes('gpt-5') ? undefined : options.temperature,
        max_tokens: this.model.includes('gpt-5') || this.model.includes('gpt-4o') 
          ? undefined 
          : options.maxTokens,
        max_completion_tokens: this.model.includes('gpt-5') || this.model.includes('gpt-4o')
          ? options.maxTokens
          : undefined,
        stream: false,
        stop: options.stopSequences,
        top_p: options.topP,
        frequency_penalty: options.frequencyPenalty,
        presence_penalty: options.presencePenalty,
      });

      if (!completion.choices || completion.choices.length === 0) {
        throw new Error('No response from API');
      }

      const content = completion.choices[0].message.content || '';
      const finishReason = completion.choices[0].finish_reason;
      
      return {
        content,
        usage: completion.usage ? {
          promptTokens: completion.usage.prompt_tokens,
          completionTokens: completion.usage.completion_tokens,
          totalTokens: completion.usage.total_tokens,
        } : undefined,
        model: completion.model,
        finishReason,
      };
    } catch (error: any) {
      if (error instanceof OpenAI.APIError) {
        throw new Error(`API Error (${error.status}): ${error.message}`);
      }
      throw new Error(`Error: ${error.message}`);
    }
  }

  async *streamComplete(options: CompletionOptions): AsyncGenerator<StreamChunk, void, unknown> {
    try {
      const stream = await this.client.chat.completions.create({
        model: options.model || this.model,
        messages: options.messages || [],
        temperature: this.model.includes('gpt-5') ? undefined : options.temperature,
        max_tokens: this.model.includes('gpt-5') || this.model.includes('gpt-4o') 
          ? undefined 
          : options.maxTokens,
        max_completion_tokens: this.model.includes('gpt-5') || this.model.includes('gpt-4o')
          ? options.maxTokens
          : undefined,
        stream: true,
        stop: options.stopSequences,
        top_p: options.topP,
        frequency_penalty: options.frequencyPenalty,
        presence_penalty: options.presencePenalty,
      });

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        const finishReason = chunk.choices[0]?.finish_reason;
        
        if (content) {
          yield { content, done: false };
        }
        
        if (finishReason) {
          yield { content: '', done: true };
          return;
        }
      }
    } catch (error: any) {
      if (error instanceof OpenAI.APIError) {
        throw new Error(`API Error (${error.status}): ${error.message}`);
      }
      throw new Error(`Error: ${error.message}`);
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
      const models = await this.client.models.list();
      const gptModels = models.data
        .filter((model: any) => model.id.includes('gpt'))
        .map((model: any) => model.id)
        .sort();
      return gptModels;
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
      await this.client.models.list();
      return true;
    } catch {
      return false;
    }
  }
}