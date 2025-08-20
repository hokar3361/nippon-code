#!/usr/bin/env node

import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';

async function postInstall() {
  console.log(chalk.cyan('\n🚀 NipponCode セットアップ\n'));

  try {
    // グローバル設定ディレクトリの作成
    const globalConfigDir = path.join(os.homedir(), '.nipponcode');
    await fs.ensureDir(globalConfigDir);
    console.log(chalk.green('✓'), 'グローバル設定ディレクトリを作成しました');

    // サンプル設定ファイルのコピー
    const envExamplePath = path.join(__dirname, '..', 'env.example');
    const globalEnvPath = path.join(globalConfigDir, 'env.example');
    
    if (await fs.pathExists(envExamplePath)) {
      await fs.copy(envExamplePath, globalEnvPath, { overwrite: false });
      console.log(chalk.green('✓'), 'サンプル設定ファイルをコピーしました');
    }

    console.log(chalk.green('\n✨ セットアップが完了しました！'));
    console.log(chalk.gray('\n次のステップ:'));
    console.log(chalk.white('  1. nipponcode init      # 初期設定'));
    console.log(chalk.white('  2. nipponcode chat      # 対話開始'));
    
  } catch (error) {
    // エラーが発生してもインストールは続行
    console.warn(chalk.yellow('⚠️  セットアップ中に警告が発生しました:'), error);
  }
}

// メイン実行
if (require.main === module) {
  postInstall().catch(console.error);
}
