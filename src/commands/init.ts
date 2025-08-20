import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import { config } from '../config';
import { initializeProject } from '../utils/setup';
import { ProviderFactory } from '../providers';

interface InitOptions {
  force?: boolean;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export async function initCommand(options: InitOptions): Promise<void> {
  console.log(chalk.cyan('\n🚀 NipponCode プロジェクト初期化\n'));

  try {
    // プロジェクトディレクトリを初期化
    const spinner = ora('プロジェクトを初期化しています...').start();
    await initializeProject(options.force || false);
    spinner.succeed('プロジェクトを初期化しました');

    // 設定の確認と入力
    const answers = await promptConfiguration(options);
    
    // 設定を更新
    if (answers.apiKey) config.set('apiKey', answers.apiKey);
    if (answers.baseUrl) config.set('apiBaseUrl', answers.baseUrl);
    if (answers.model) config.set('model', answers.model);
    if (answers.language) config.set('language', answers.language as 'ja' | 'en');

    // 設定を保存
    const saveSpinner = ora('設定を保存しています...').start();
    await config.save();
    saveSpinner.succeed('設定を保存しました');

    // API接続テスト
    if (answers.testConnection) {
      const testSpinner = ora('API接続をテストしています...').start();
      const isHealthy = await ProviderFactory.checkHealth();
      
      if (isHealthy) {
        testSpinner.succeed('API接続に成功しました');
      } else {
        testSpinner.fail('API接続に失敗しました');
        console.log(chalk.yellow('\n⚠️  APIキーとベースURLを確認してください'));
      }
    }

    // 完了メッセージ
    console.log(chalk.green('\n✨ 初期化が完了しました！\n'));
    console.log(chalk.gray('次のコマンドで対話を開始できます:'));
    console.log(chalk.white('  nipponcode chat'));
    console.log();
    console.log(chalk.gray('プロジェクトを分析する場合:'));
    console.log(chalk.white('  nipponcode analyze'));

  } catch (error: any) {
    console.error(chalk.red('\n❌ エラー:'), error.message);
    process.exit(1);
  }
}

async function promptConfiguration(options: InitOptions): Promise<any> {
  const questions = [];

  // APIキー
  if (!options.apiKey) {
    const currentKey = config.get('apiKey');
    questions.push({
      type: 'password',
      name: 'apiKey',
      message: 'APIキーを入力してください:',
      default: currentKey || undefined,
      validate: (input: string) => {
        if (!input) {
          return 'APIキーは必須です';
        }
        return true;
      },
    });
  }

  // ベースURL
  if (!options.baseUrl) {
    const currentUrl = config.get('apiBaseUrl');
    questions.push({
      type: 'input',
      name: 'baseUrl',
      message: 'APIベースURLを入力してください:',
      default: currentUrl || 'https://api.openai.com/v1',
      validate: (input: string) => {
        try {
          new URL(input);
          return true;
        } catch {
          return '有効なURLを入力してください';
        }
      },
    });
  }

  // モデル選択
  if (!options.model) {
    const currentModel = config.get('model');
    questions.push({
      type: 'list',
      name: 'model',
      message: '使用するモデルを選択してください:',
      choices: [
        { name: 'GPT-4 Turbo (最新・高性能)', value: 'gpt-4-turbo-preview' },
        { name: 'GPT-4 (安定版)', value: 'gpt-4' },
        { name: 'GPT-3.5 Turbo (高速・低コスト)', value: 'gpt-3.5-turbo' },
        { name: 'カスタム (手動入力)', value: 'custom' },
      ],
      default: currentModel || 'gpt-4-turbo-preview',
    });
  }

  const answers = await inquirer.prompt(questions);

  // カスタムモデルの場合は追加入力
  if (answers.model === 'custom') {
    const customModel = await inquirer.prompt({
      type: 'input',
      name: 'customModel',
      message: 'カスタムモデル名を入力してください:',
      validate: (input: string) => {
        if (!input) {
          return 'モデル名は必須です';
        }
        return true;
      },
    });
    answers.model = customModel.customModel;
  }

  // 追加設定
  const additionalQuestions = await inquirer.prompt([
    {
      type: 'list',
      name: 'language',
      message: '使用言語を選択してください:',
      choices: [
        { name: '日本語', value: 'ja' },
        { name: 'English', value: 'en' },
      ],
      default: 'ja',
    },
    {
      type: 'confirm',
      name: 'testConnection',
      message: 'API接続をテストしますか？',
      default: true,
    },
  ]);

  return {
    apiKey: options.apiKey || answers.apiKey,
    baseUrl: options.baseUrl || answers.baseUrl,
    model: options.model || answers.model,
    ...additionalQuestions,
  };
}

