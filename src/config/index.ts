import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import dotenv from 'dotenv';
import chalk from 'chalk';

export interface VLLMConfig {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
  debug: boolean;
  sessionDir: string;
  maxParallel: number;
  analysisDepth: number;
  streaming: boolean;
  language: 'ja' | 'en';
}

export class ConfigManager {
  private static instance: ConfigManager;
  private config: VLLMConfig;
  private configPath: string;
  private globalConfigPath: string;

  private constructor() {
    // 設定ファイルのパス
    this.configPath = path.join(process.cwd(), '.nipponcode', 'config.json');
    this.globalConfigPath = path.join(os.homedir(), '.nipponcode', 'config.json');
    
    // デフォルト設定
    this.config = this.loadDefaultConfig();
    
    // 設定の読み込み
    this.loadConfig();
  }

  public static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  private loadDefaultConfig(): VLLMConfig {
    return {
      apiBaseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-4-turbo-preview',
      maxTokens: 4096,
      temperature: 0.7,
      debug: false,
      sessionDir: '.nipponcode/sessions',
      maxParallel: 5,
      analysisDepth: 3,
      streaming: true,
      language: 'ja',
    };
  }

  private loadConfig(): void {
    // 環境変数から読み込み
    dotenv.config();
    this.loadFromEnv();

    // グローバル設定ファイルから読み込み
    if (fs.existsSync(this.globalConfigPath)) {
      try {
        const globalConfig = fs.readJsonSync(this.globalConfigPath);
        this.config = { ...this.config, ...globalConfig };
      } catch (error) {
        console.warn(chalk.yellow('グローバル設定ファイルの読み込みに失敗しました'));
      }
    }

    // ローカル設定ファイルから読み込み
    if (fs.existsSync(this.configPath)) {
      try {
        const localConfig = fs.readJsonSync(this.configPath);
        this.config = { ...this.config, ...localConfig };
      } catch (error) {
        console.warn(chalk.yellow('ローカル設定ファイルの読み込みに失敗しました'));
      }
    }
  }

  private loadFromEnv(): void {
    if (process.env.VLLM_API_BASE_URL) {
      this.config.apiBaseUrl = process.env.VLLM_API_BASE_URL;
    }
    if (process.env.VLLM_API_KEY) {
      this.config.apiKey = process.env.VLLM_API_KEY;
    }
    if (process.env.VLLM_MODEL) {
      this.config.model = process.env.VLLM_MODEL;
    }
    if (process.env.VLLM_MAX_TOKENS) {
      this.config.maxTokens = parseInt(process.env.VLLM_MAX_TOKENS);
    }
    if (process.env.VLLM_TEMPERATURE) {
      this.config.temperature = parseFloat(process.env.VLLM_TEMPERATURE);
    }
    if (process.env.VLLM_DEBUG) {
      this.config.debug = process.env.VLLM_DEBUG === 'true';
    }
    if (process.env.VLLM_SESSION_DIR) {
      this.config.sessionDir = process.env.VLLM_SESSION_DIR;
    }
    if (process.env.VLLM_MAX_PARALLEL) {
      this.config.maxParallel = parseInt(process.env.VLLM_MAX_PARALLEL);
    }
    if (process.env.VLLM_ANALYSIS_DEPTH) {
      this.config.analysisDepth = parseInt(process.env.VLLM_ANALYSIS_DEPTH);
    }
  }

  public getConfig(): VLLMConfig {
    return { ...this.config };
  }

  public get<K extends keyof VLLMConfig>(key: K): VLLMConfig[K] {
    return this.config[key];
  }

  public set<K extends keyof VLLMConfig>(key: K, value: VLLMConfig[K]): void {
    this.config[key] = value;
  }

  public async save(global: boolean = false): Promise<void> {
    const targetPath = global ? this.globalConfigPath : this.configPath;
    const targetDir = path.dirname(targetPath);

    // ディレクトリを作成
    await fs.ensureDir(targetDir);

    // すべての設定を保存（APIキーを含む）
    const configToSave = { ...this.config };

    await fs.writeJson(targetPath, configToSave, { spaces: 2 });
  }

  public async reset(): Promise<void> {
    this.config = this.loadDefaultConfig();
    this.loadFromEnv();
  }

  public validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!this.config.apiKey) {
      errors.push('APIキーが設定されていません');
    }

    if (!this.config.apiBaseUrl) {
      errors.push('APIベースURLが設定されていません');
    }

    if (!this.config.model) {
      errors.push('モデルが設定されていません');
    }

    if (this.config.temperature < 0 || this.config.temperature > 2) {
      errors.push('温度パラメータは0.0から2.0の間で設定してください');
    }

    if (this.config.maxTokens < 1) {
      errors.push('最大トークン数は1以上に設定してください');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  public display(): void {
    console.log(chalk.cyan('=== VLLMCode 設定 ==='));
    console.log(chalk.gray('API Base URL:'), this.config.apiBaseUrl);
    console.log(chalk.gray('API Key:'), this.config.apiKey ? '***' + this.config.apiKey.slice(-4) : '未設定');
    console.log(chalk.gray('Model:'), this.config.model);
    console.log(chalk.gray('Max Tokens:'), this.config.maxTokens);
    console.log(chalk.gray('Temperature:'), this.config.temperature);
    console.log(chalk.gray('Debug:'), this.config.debug);
    console.log(chalk.gray('Session Dir:'), this.config.sessionDir);
    console.log(chalk.gray('Max Parallel:'), this.config.maxParallel);
    console.log(chalk.gray('Analysis Depth:'), this.config.analysisDepth);
    console.log(chalk.gray('Streaming:'), this.config.streaming);
    console.log(chalk.gray('Language:'), this.config.language);
  }
}

export const config = ConfigManager.getInstance();

