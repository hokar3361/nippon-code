import fs from 'fs-extra';
import path from 'path';
import { glob } from 'glob';
import ignore from 'ignore';
import { getFileInfo, detectLanguage } from '../utils/files';

export interface ProjectAnalysis {
  rootPath: string;
  structure: DirectoryStructure;
  statistics: ProjectStatistics;
  dependencies?: Dependencies;
  languages: LanguageStats[];
  mainFiles: FileInfo[];
}

export interface DirectoryStructure {
  name: string;
  type: 'directory' | 'file';
  path: string;
  children?: DirectoryStructure[];
  size?: number;
  language?: string;
}

export interface ProjectStatistics {
  totalFiles: number;
  totalDirectories: number;
  totalSize: number;
  totalLines: number;
  averageFileSize: number;
}

export interface Dependencies {
  npm?: NpmDependencies;
  python?: PythonDependencies;
  other?: Record<string, any>;
}

export interface NpmDependencies {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

export interface PythonDependencies {
  requirements: string[];
  pipfile?: Record<string, any>;
}

export interface LanguageStats {
  language: string;
  files: number;
  lines: number;
  size: number;
  percentage: number;
}

export interface FileInfo {
  name: string;
  path: string;
  size: number;
  lines: number;
  language: string;
}

export interface AnalyzeOptions {
  depth?: number;
  includeStructure?: boolean;
  includeDependencies?: boolean;
  includeStatistics?: boolean;
  maxFiles?: number;
  ignorePatterns?: string[];
}

export class ProjectAnalyzer {
  private ig = ignore();

  constructor() {
    // デフォルトの無視パターン
    this.ig.add([
      'node_modules',
      '.git',
      '.vscode',
      '.idea',
      'dist',
      'build',
      '__pycache__',
      '*.pyc',
      '.DS_Store',
      'Thumbs.db',
      '.nipponcode',
    ]);
  }

  public async analyzeDirectory(
    dirPath: string,
    options: AnalyzeOptions = {}
  ): Promise<ProjectAnalysis> {
    const {
      depth = 3,
      includeStructure = true,
      includeDependencies = true,
      includeStatistics = true,
      maxFiles = 1000,
      ignorePatterns = [],
    } = options;

    // 追加の無視パターン
    if (ignorePatterns.length > 0) {
      this.ig.add(ignorePatterns);
    }

    // .gitignoreファイルを読み込む
    await this.loadGitignore(dirPath);

    const absolutePath = path.isAbsolute(dirPath) ? dirPath : path.join(process.cwd(), dirPath);

    const analysis: ProjectAnalysis = {
      rootPath: absolutePath,
      structure: { name: path.basename(absolutePath), type: 'directory', path: absolutePath },
      statistics: {
        totalFiles: 0,
        totalDirectories: 0,
        totalSize: 0,
        totalLines: 0,
        averageFileSize: 0,
      },
      languages: [],
      mainFiles: [],
    };

    // ディレクトリ構造の分析
    if (includeStructure) {
      analysis.structure = await this.buildDirectoryStructure(absolutePath, depth);
    }

    // ファイルリストの取得
    const files = await this.getProjectFiles(absolutePath, maxFiles);

    // 統計情報の収集
    if (includeStatistics) {
      analysis.statistics = await this.collectStatistics(files);
    }

    // 言語統計の収集
    analysis.languages = await this.collectLanguageStats(files);

    // 主要ファイルの特定
    analysis.mainFiles = await this.identifyMainFiles(absolutePath);

    // 依存関係の分析
    if (includeDependencies) {
      analysis.dependencies = await this.analyzeDependencies(absolutePath);
    }

    return analysis;
  }

  private async loadGitignore(dirPath: string): Promise<void> {
    const gitignorePath = path.join(dirPath, '.gitignore');
    if (await fs.pathExists(gitignorePath)) {
      const content = await fs.readFile(gitignorePath, 'utf-8');
      this.ig.add(content);
    }
  }

  private async buildDirectoryStructure(
    dirPath: string,
    maxDepth: number,
    currentDepth: number = 0
  ): Promise<DirectoryStructure> {
    const name = path.basename(dirPath);
    const structure: DirectoryStructure = {
      name,
      type: 'directory',
      path: dirPath,
      children: [],
    };

    if (currentDepth >= maxDepth) {
      return structure;
    }

    try {
      const items = await fs.readdir(dirPath);

      for (const item of items) {
        // 無視パターンのチェック
        if (this.ig.ignores(item)) {
          continue;
        }

        const itemPath = path.join(dirPath, item);
        const stats = await fs.stat(itemPath);

        if (stats.isDirectory()) {
          const childStructure = await this.buildDirectoryStructure(
            itemPath,
            maxDepth,
            currentDepth + 1
          );
          structure.children!.push(childStructure);
        } else {
          structure.children!.push({
            name: item,
            type: 'file',
            path: itemPath,
            size: stats.size,
            language: detectLanguage(item),
          });
        }
      }
    } catch (error) {
      // アクセスできないディレクトリは無視
    }

    return structure;
  }

  private async getProjectFiles(dirPath: string, maxFiles: number): Promise<string[]> {
    const files = await glob('**/*', {
      cwd: dirPath,
      nodir: true,
      dot: false,
      ignore: ['node_modules/**', '.git/**', '.nipponcode/**'],
    });

    // gitignoreフィルタリング
    const filtered = files
      .filter((file: string) => !this.ig.ignores(file))
      .slice(0, maxFiles)
      .map((file: string) => path.join(dirPath, file));

    return filtered;
  }

  private async collectStatistics(files: string[]): Promise<ProjectStatistics> {
    let totalSize = 0;
    let totalLines = 0;
    const directories = new Set<string>();

    for (const file of files) {
      try {
        const stats = await fs.stat(file);
        totalSize += stats.size;

        // テキストファイルの行数をカウント
        if (this.isTextFile(file)) {
          const content = await fs.readFile(file, 'utf-8');
          totalLines += content.split('\n').length;
        }

        // ディレクトリをカウント
        const dir = path.dirname(file);
        directories.add(dir);
      } catch (error) {
        // エラーは無視
      }
    }

    return {
      totalFiles: files.length,
      totalDirectories: directories.size,
      totalSize,
      totalLines,
      averageFileSize: files.length > 0 ? Math.round(totalSize / files.length) : 0,
    };
  }

  private async collectLanguageStats(files: string[]): Promise<LanguageStats[]> {
    const stats: Map<string, LanguageStats> = new Map();

    for (const file of files) {
      try {
        const language = detectLanguage(file);
        const fileStats = await fs.stat(file);
        let lines = 0;

        if (this.isTextFile(file)) {
          const content = await fs.readFile(file, 'utf-8');
          lines = content.split('\n').length;
        }

        if (!stats.has(language)) {
          stats.set(language, {
            language,
            files: 0,
            lines: 0,
            size: 0,
            percentage: 0,
          });
        }

        const langStats = stats.get(language)!;
        langStats.files++;
        langStats.lines += lines;
        langStats.size += fileStats.size;
      } catch (error) {
        // エラーは無視
      }
    }

    // パーセンテージを計算
    const totalSize = Array.from(stats.values()).reduce((sum, s) => sum + s.size, 0);
    for (const langStats of stats.values()) {
      langStats.percentage = totalSize > 0 ? (langStats.size / totalSize) * 100 : 0;
    }

    // ファイル数でソート
    return Array.from(stats.values()).sort((a, b) => b.files - a.files);
  }

  private async identifyMainFiles(dirPath: string): Promise<FileInfo[]> {
    const mainFilePatterns = [
      'package.json',
      'tsconfig.json',
      'README.md',
      'requirements.txt',
      'Pipfile',
      'setup.py',
      'Cargo.toml',
      'go.mod',
      'pom.xml',
      'build.gradle',
      'Makefile',
      'CMakeLists.txt',
      '.env.example',
      'docker-compose.yml',
      'Dockerfile',
    ];

    const mainFiles: FileInfo[] = [];

    for (const pattern of mainFilePatterns) {
      const filePath = path.join(dirPath, pattern);
      if (await fs.pathExists(filePath)) {
        try {
          const info = await getFileInfo(filePath);
          mainFiles.push({
            name: info.name,
            path: info.relativePath,
            size: info.size,
            lines: info.lines,
            language: info.language,
          });
        } catch (error) {
          // エラーは無視
        }
      }
    }

    return mainFiles;
  }

  private async analyzeDependencies(dirPath: string): Promise<Dependencies> {
    const deps: Dependencies = {};

    // NPM dependencies
    const packageJsonPath = path.join(dirPath, 'package.json');
    if (await fs.pathExists(packageJsonPath)) {
      try {
        const packageJson = await fs.readJson(packageJsonPath);
        deps.npm = {
          dependencies: packageJson.dependencies || {},
          devDependencies: packageJson.devDependencies || {},
          peerDependencies: packageJson.peerDependencies,
        };
      } catch (error) {
        // エラーは無視
      }
    }

    // Python dependencies
    const requirementsPath = path.join(dirPath, 'requirements.txt');
    if (await fs.pathExists(requirementsPath)) {
      try {
        const content = await fs.readFile(requirementsPath, 'utf-8');
        deps.python = {
          requirements: content
            .split('\n')
            .filter(line => line.trim() && !line.startsWith('#')),
        };
      } catch (error) {
        // エラーは無視
      }
    }

    return deps;
  }

  private isTextFile(filePath: string): boolean {
    const textExtensions = [
      '.txt', '.md', '.js', '.jsx', '.ts', '.tsx', '.json', '.yml', '.yaml',
      '.html', '.css', '.scss', '.sass', '.less',
      '.py', '.rb', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp',
      '.cs', '.php', '.swift', '.kt', '.scala', '.r', '.jl', '.m',
      '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd',
      '.sql', '.graphql', '.proto',
      '.xml', '.svg', '.tex', '.rst', '.org',
      '.env', '.ini', '.toml', '.cfg', '.conf',
    ];

    const ext = path.extname(filePath).toLowerCase();
    return textExtensions.includes(ext);
  }

  public formatAnalysis(analysis: ProjectAnalysis): string {
    const lines: string[] = [];

    lines.push(`📁 プロジェクト分析: ${path.basename(analysis.rootPath)}`);
    lines.push('');

    // 統計情報
    if (analysis.statistics) {
      lines.push('📊 統計情報:');
      lines.push(`  ファイル数: ${analysis.statistics.totalFiles}`);
      lines.push(`  ディレクトリ数: ${analysis.statistics.totalDirectories}`);
      lines.push(`  総サイズ: ${this.formatSize(analysis.statistics.totalSize)}`);
      lines.push(`  総行数: ${analysis.statistics.totalLines.toLocaleString()}`);
      lines.push(`  平均ファイルサイズ: ${this.formatSize(analysis.statistics.averageFileSize)}`);
      lines.push('');
    }

    // 言語統計
    if (analysis.languages.length > 0) {
      lines.push('💻 言語統計:');
      for (const lang of analysis.languages.slice(0, 5)) {
        lines.push(`  ${lang.language}: ${lang.files}ファイル (${lang.percentage.toFixed(1)}%)`);
      }
      lines.push('');
    }

    // 主要ファイル
    if (analysis.mainFiles.length > 0) {
      lines.push('📄 主要ファイル:');
      for (const file of analysis.mainFiles) {
        lines.push(`  ${file.name}`);
      }
      lines.push('');
    }

    // 依存関係
    if (analysis.dependencies) {
      if (analysis.dependencies.npm) {
        lines.push('📦 NPM依存関係:');
        const deps = Object.keys(analysis.dependencies.npm.dependencies);
        const devDeps = Object.keys(analysis.dependencies.npm.devDependencies);
        lines.push(`  本番: ${deps.length}個`);
        lines.push(`  開発: ${devDeps.length}個`);
        lines.push('');
      }

      if (analysis.dependencies.python) {
        lines.push('🐍 Python依存関係:');
        lines.push(`  パッケージ数: ${analysis.dependencies.python.requirements.length}`);
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  private formatSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }
}

