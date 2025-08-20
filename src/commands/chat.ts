import { InteractiveChat } from './interactive-chat';
import { config } from '../config';
import chalk from 'chalk';

export async function chatCommand(): Promise<void> {
  // 設定の検証
  const validation = config.validate();
  if (!validation.valid) {
    console.error(chalk.red('\n設定エラー:'));
    validation.errors.forEach(error => {
      console.error(chalk.red(`  - ${error}`));
    });
    console.log(chalk.yellow('\n初期化を実行してください: nipponcode init'));
    process.exit(1);
  }

  // 対話型チャットを開始
  const chat = new InteractiveChat();
  await chat.start();
}