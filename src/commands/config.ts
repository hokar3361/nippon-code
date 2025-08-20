import chalk from 'chalk';
import { config } from '../config';

interface ConfigOptions {
  set?: string;
  get?: string;
  list?: boolean;
  reset?: boolean;
}

export async function configCommand(options: ConfigOptions): Promise<void> {
  console.log(chalk.cyan('\n⚙️  VLLMCode 設定管理\n'));

  try {
    // 設定をリセット
    if (options.reset) {
      await config.reset();
      await config.save();
      console.log(chalk.green('✅ 設定をリセットしました'));
      return;
    }

    // すべての設定を表示
    if (options.list) {
      config.display();
      return;
    }

    // 特定の設定値を取得
    if (options.get) {
      const value = getConfigValue(options.get);
      if (value !== undefined) {
        console.log(chalk.gray(`${options.get}:`), value);
      } else {
        console.error(chalk.red(`❌ 不明な設定キー: ${options.get}`));
        process.exit(1);
      }
      return;
    }

    // 設定値を設定
    if (options.set) {
      const [key, ...valueParts] = options.set.split('=');
      const value = valueParts.join('=');

      if (!value) {
        console.error(chalk.red('❌ 値を指定してください（例: --set key=value）'));
        process.exit(1);
      }

      if (setConfigValue(key, value)) {
        await config.save();
        console.log(chalk.green(`✅ ${key} を設定しました`));
      } else {
        console.error(chalk.red(`❌ 不明な設定キー: ${key}`));
        process.exit(1);
      }
      return;
    }

    // デフォルト：現在の設定を表示
    config.display();

  } catch (error: any) {
    console.error(chalk.red('❌ エラー:'), error.message);
    process.exit(1);
  }
}

function getConfigValue(key: string): any {
  const validKeys = [
    'apiBaseUrl',
    'apiKey',
    'model',
    'maxTokens',
    'temperature',
    'debug',
    'sessionDir',
    'maxParallel',
    'analysisDepth',
    'streaming',
    'language',
  ];

  if (validKeys.includes(key)) {
    return config.get(key as any);
  }

  return undefined;
}

function setConfigValue(key: string, value: string): boolean {
  try {
    switch (key) {
      case 'apiBaseUrl':
        config.set('apiBaseUrl', value);
        return true;
      
      case 'apiKey':
        config.set('apiKey', value);
        return true;
      
      case 'model':
        config.set('model', value);
        return true;
      
      case 'maxTokens':
        config.set('maxTokens', parseInt(value));
        return true;
      
      case 'temperature':
        const temp = parseFloat(value);
        if (temp < 0 || temp > 2) {
          throw new Error('温度は0.0から2.0の間で設定してください');
        }
        config.set('temperature', temp);
        return true;
      
      case 'debug':
        config.set('debug', value.toLowerCase() === 'true');
        return true;
      
      case 'sessionDir':
        config.set('sessionDir', value);
        return true;
      
      case 'maxParallel':
        config.set('maxParallel', parseInt(value));
        return true;
      
      case 'analysisDepth':
        config.set('analysisDepth', parseInt(value));
        return true;
      
      case 'streaming':
        config.set('streaming', value.toLowerCase() === 'true');
        return true;
      
      case 'language':
        if (value !== 'ja' && value !== 'en') {
          throw new Error('言語は "ja" または "en" を指定してください');
        }
        config.set('language', value as 'ja' | 'en');
        return true;
      
      default:
        return false;
    }
  } catch (error: any) {
    console.error(chalk.red('エラー:'), error.message);
    return false;
  }
}
