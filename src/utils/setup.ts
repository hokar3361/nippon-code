import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import os from 'os';

/**
 * 環境のセットアップを行う
 */
export async function setupEnvironment(): Promise<void> {
  // グローバル設定ディレクトリの作成
  const globalConfigDir = path.join(os.homedir(), '.nipponcode');
  await fs.ensureDir(globalConfigDir);

  // ローカル設定ディレクトリの確認
  const localConfigDir = path.join(process.cwd(), '.nipponcode');
  if (await fs.pathExists(localConfigDir)) {
    // セッションディレクトリの作成
    const sessionDir = path.join(localConfigDir, 'sessions');
    await fs.ensureDir(sessionDir);
  }
}

/**
 * プロジェクトの初期化
 */
export async function initializeProject(force: boolean = false): Promise<void> {
  const projectDir = process.cwd();
  const configDir = path.join(projectDir, '.nipponcode');
  
  // 既存の設定を確認
  if (await fs.pathExists(configDir) && !force) {
    throw new Error('プロジェクトは既に初期化されています。--force オプションを使用して上書きしてください。');
  }

  // ディレクトリ構造の作成
  await fs.ensureDir(configDir);
  await fs.ensureDir(path.join(configDir, 'sessions'));
  await fs.ensureDir(path.join(configDir, 'cache'));
  await fs.ensureDir(path.join(configDir, 'logs'));

  // .gitignore の更新
  await updateGitignore(projectDir);

  console.log(chalk.green('✓'), 'プロジェクトを初期化しました');
}

/**
 * .gitignore ファイルを更新
 */
async function updateGitignore(projectDir: string): Promise<void> {
  const gitignorePath = path.join(projectDir, '.gitignore');
  const nipponcodeIgnore = '\n# NipponCode\n.nipponcode/\n*.session.json\n';

  if (await fs.pathExists(gitignorePath)) {
    const content = await fs.readFile(gitignorePath, 'utf-8');
    if (!content.includes('.nipponcode/')) {
      await fs.appendFile(gitignorePath, nipponcodeIgnore);
      console.log(chalk.gray('  .gitignore を更新しました'));
    }
  } else {
    await fs.writeFile(gitignorePath, nipponcodeIgnore.trim());
    console.log(chalk.gray('  .gitignore を作成しました'));
  }
}

/**
 * セッションディレクトリのパスを取得
 */
export function getSessionDir(): string {
  const localSessionDir = path.join(process.cwd(), '.nipponcode', 'sessions');
  if (fs.existsSync(localSessionDir)) {
    return localSessionDir;
  }
  return path.join(os.homedir(), '.nipponcode', 'sessions');
}

/**
 * キャッシュディレクトリのパスを取得
 */
export function getCacheDir(): string {
  const localCacheDir = path.join(process.cwd(), '.nipponcode', 'cache');
  if (fs.existsSync(localCacheDir)) {
    return localCacheDir;
  }
  return path.join(os.homedir(), '.nipponcode', 'cache');
}

