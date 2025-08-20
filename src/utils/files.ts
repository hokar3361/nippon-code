import fs from 'fs-extra';
import path from 'path';
import { glob } from 'glob';
import ignore from 'ignore';
import { diffLines, Change } from 'diff';
import chalk from 'chalk';

/**
 * ファイルを読み込む
 */
export async function readFile(filePath: string): Promise<string> {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  return await fs.readFile(absolutePath, 'utf-8');
}

/**
 * ファイルに書き込む
 */
export async function writeFile(filePath: string, content: string): Promise<void> {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  await fs.ensureDir(path.dirname(absolutePath));
  await fs.writeFile(absolutePath, content, 'utf-8');
}

/**
 * ファイルの存在を確認
 */
export async function fileExists(filePath: string): Promise<boolean> {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  return await fs.pathExists(absolutePath);
}

/**
 * ディレクトリ内のファイルをリスト
 */
export async function listFiles(
  directory: string,
  options: {
    recursive?: boolean;
    extensions?: string[];
    ignorePatterns?: string[];
    maxDepth?: number;
  } = {}
): Promise<string[]> {
  const {
    recursive = true,
    extensions = [],
    ignorePatterns = [],
    maxDepth = 10,
  } = options;

  const absolutePath = path.isAbsolute(directory) ? directory : path.join(process.cwd(), directory);
  
  // .gitignore ファイルを読み込む
  const gitignorePath = path.join(absolutePath, '.gitignore');
  let ig = ignore();
  
  if (await fs.pathExists(gitignorePath)) {
    const gitignoreContent = await fs.readFile(gitignorePath, 'utf-8');
    ig = ig.add(gitignoreContent);
  }
  
  // カスタムの無視パターンを追加
  ig = ig.add(ignorePatterns);
  
  // glob パターンを構築
  let pattern = recursive ? '**/*' : '*';
  if (extensions.length > 0) {
    pattern = recursive ? `**/*.{${extensions.join(',')}}` : `*.{${extensions.join(',')}}`;
  }
  
  return glob(pattern, {
    cwd: absolutePath,
    dot: false,
    nodir: true,
    ignore: ['node_modules/**', '.git/**', '.nipponcode/**'],
  }).then((files: string[]) => {
    // gitignore フィルタリング
    const filteredFiles = files.filter((file: string) => !ig.ignores(file));
    
    // 深さ制限
    const limitedFiles = filteredFiles.filter((file: string) => {
      const depth = file.split(path.sep).length;
      return depth <= maxDepth;
    });
    
    // 絶対パスに変換
    const absoluteFiles = limitedFiles.map((file: string) => path.join(absolutePath, file));
    
    return absoluteFiles;
  });
}

/**
 * ファイルの差分を表示
 */
export function showDiff(original: string, modified: string, fileName?: string): void {
  const changes = diffLines(original, modified);
  
  if (fileName) {
    console.log(chalk.cyan(`\n=== ${fileName} の変更 ===`));
  }
  
  changes.forEach((part: Change) => {
    if (part.added) {
      console.log(chalk.green(part.value.split('\n').map(line => '+ ' + line).join('\n')));
    } else if (part.removed) {
      console.log(chalk.red(part.value.split('\n').map(line => '- ' + line).join('\n')));
    } else {
      // コンテキスト行（変更なし）は最初と最後の3行のみ表示
      const lines = part.value.split('\n').filter(l => l);
      if (lines.length > 6) {
        lines.slice(0, 3).forEach(line => console.log(chalk.gray('  ' + line)));
        console.log(chalk.gray('  ...'));
        lines.slice(-3).forEach(line => console.log(chalk.gray('  ' + line)));
      } else {
        lines.forEach(line => console.log(chalk.gray('  ' + line)));
      }
    }
  });
}

/**
 * ファイルサイズを取得
 */
export async function getFileSize(filePath: string): Promise<number> {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  const stats = await fs.stat(absolutePath);
  return stats.size;
}

/**
 * ファイルの拡張子を取得
 */
export function getFileExtension(filePath: string): string {
  return path.extname(filePath).toLowerCase();
}

/**
 * プログラミング言語を推定
 */
export function detectLanguage(filePath: string): string {
  const ext = getFileExtension(filePath);
  const languageMap: Record<string, string> = {
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.py': 'python',
    '.java': 'java',
    '.c': 'c',
    '.cpp': 'cpp',
    '.cs': 'csharp',
    '.go': 'go',
    '.rs': 'rust',
    '.rb': 'ruby',
    '.php': 'php',
    '.swift': 'swift',
    '.kt': 'kotlin',
    '.scala': 'scala',
    '.r': 'r',
    '.m': 'matlab',
    '.jl': 'julia',
    '.sh': 'bash',
    '.ps1': 'powershell',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.json': 'json',
    '.xml': 'xml',
    '.html': 'html',
    '.css': 'css',
    '.scss': 'scss',
    '.sass': 'sass',
    '.less': 'less',
    '.sql': 'sql',
    '.md': 'markdown',
    '.tex': 'latex',
  };
  
  return languageMap[ext] || 'text';
}

/**
 * ファイルパスを相対パスに変換
 */
export function toRelativePath(filePath: string, basePath?: string): string {
  const base = basePath || process.cwd();
  return path.relative(base, filePath);
}

/**
 * ファイルの情報を取得
 */
export async function getFileInfo(filePath: string): Promise<{
  name: string;
  path: string;
  relativePath: string;
  size: number;
  extension: string;
  language: string;
  lines: number;
  lastModified: Date;
}> {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  const stats = await fs.stat(absolutePath);
  const content = await fs.readFile(absolutePath, 'utf-8');
  const lines = content.split('\n').length;
  
  return {
    name: path.basename(filePath),
    path: absolutePath,
    relativePath: toRelativePath(absolutePath),
    size: stats.size,
    extension: getFileExtension(filePath),
    language: detectLanguage(filePath),
    lines,
    lastModified: stats.mtime,
  };
}

