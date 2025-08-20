import { AIProvider } from './base';
import { OpenAIProvider } from './openai';
import { config } from '../config';

export * from './base';
export * from './openai';

export class ProviderFactory {
  private static instance: AIProvider | null = null;

  /**
   * 設定に基づいてAIプロバイダーのインスタンスを取得
   */
  public static getProvider(): AIProvider {
    if (!ProviderFactory.instance) {
      const cfg = config.getConfig();
      
      // 現在はOpenAI互換プロバイダーのみサポート
      // 将来的にbase_urlに基づいて異なるプロバイダーを選択可能
      ProviderFactory.instance = new OpenAIProvider(
        cfg.apiKey,
        cfg.apiBaseUrl,
        cfg.model
      );
    }
    
    return ProviderFactory.instance;
  }

  /**
   * カスタムプロバイダーを作成
   */
  public static createCustomProvider(
    apiKey: string,
    baseUrl: string,
    model: string
  ): AIProvider {
    return new OpenAIProvider(apiKey, baseUrl, model);
  }

  /**
   * プロバイダーインスタンスをリセット
   */
  public static reset(): void {
    ProviderFactory.instance = null;
  }

  /**
   * 利用可能なプロバイダータイプのリスト
   */
  public static getAvailableProviders(): string[] {
    return ['openai', 'custom'];
  }

  /**
   * プロバイダーの健全性をチェック
   */
  public static async checkHealth(): Promise<boolean> {
    try {
      const provider = ProviderFactory.getProvider();
      return await provider.healthCheck();
    } catch {
      return false;
    }
  }
}

export const provider = () => ProviderFactory.getProvider();

