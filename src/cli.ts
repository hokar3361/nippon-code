#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { version } from '../package.json';
import { initCommand } from './commands/init';
import { chatCommand } from './commands/chat';
import { analyzeCommand } from './commands/analyze';
import { configCommand } from './commands/config';
import { setupEnvironment } from './utils/setup';

const program = new Command();

// ASCII アートを動的に生成
// const logo = '';

async function main() {
  // 環境のセットアップ
  await setupEnvironment();

  program
    .name('nipponcode')
    .description(chalk.yellow('日本語に強いAIコーディングアシスタント'))
    .version(version, '-v, --version', 'バージョンを表示')
    .helpOption('-h, --help', 'ヘルプを表示');

  // init コマンド：プロジェクトの初期化
  program
    .command('init')
    .description('プロジェクトを初期化し、NipponCodeの設定を行います')
    .option('-f, --force', '既存の設定を上書き')
    .option('--api-key <key>', 'APIキーを設定')
    .option('--base-url <url>', 'APIのベースURLを設定')
    .option('--model <model>', '使用するモデルを設定')
    .action(initCommand);

  // chat コマンド：対話モード
  program
    .command('chat')
    .alias('c')
    .description('AIエージェントとの対話モードを開始')
    .option('-m, --message <message>', '単一のメッセージを送信')
    .option('-f, --file <file>', '指定ファイルのコンテキストを含める')
    .option('-d, --directory <dir>', '指定ディレクトリを分析対象に含める')
    .option('--no-stream', 'ストリーミングを無効化')
    .option('--session <name>', 'セッション名を指定')
    .option('--resume', '前回のセッションを再開')
    .action(chatCommand);

  // analyze コマンド：プロジェクト分析
  program
    .command('analyze [path]')
    .alias('a')
    .description('プロジェクトまたはファイルを分析')
    .option('-d, --depth <number>', '分析の深さ', '2')
    .option('--dependencies', '依存関係を分析')
    .option('--structure', 'プロジェクト構造を表示')
    .option('--complexity', 'コードの複雑度を計算')
    .option('-o, --output <file>', '結果をファイルに出力')
    .action(analyzeCommand);

  // config コマンド：設定管理
  program
    .command('config')
    .description('NipponCodeの設定を管理')
    .option('--set <key=value>', '設定値を設定')
    .option('--get <key>', '設定値を取得')
    .option('--list', 'すべての設定を表示')
    .option('--reset', '設定をリセット')
    .action(configCommand);

  // デフォルトアクション（引数なしで実行された場合）
  program.action(async () => {
    const { displayCompactBanner } = await import('./utils/ascii-art');
    displayCompactBanner();
    console.log(chalk.gray('使い方: nipponcode <command> [options]'));
    console.log(chalk.gray('ヘルプ: nipponcode --help'));
    console.log();
    console.log(chalk.cyan('🚀 クイックスタート:'));
    console.log(chalk.white('  nipponcode init      # プロジェクトを初期化'));
    console.log(chalk.white('  nipponcode chat      # 対話モードを開始'));
    console.log(chalk.white('  nipponcode analyze   # プロジェクトを分析'));
  });

  // エラーハンドリング
  program.exitOverride();

  try {
    await program.parseAsync(process.argv);
  } catch (error: any) {
    if (error.code === 'commander.help') {
      process.exit(0);
    }
    console.error(chalk.red('エラー:'), error.message);
    process.exit(1);
  }
}

// メイン関数の実行
main().catch((error) => {
  console.error(chalk.red('予期しないエラーが発生しました:'), error);
  process.exit(1);
});

