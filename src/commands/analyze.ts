import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs-extra';
import path from 'path';
import { ProjectAnalyzer } from '../analyzers/project';

interface AnalyzeOptions {
  depth?: string;
  dependencies?: boolean;
  structure?: boolean;
  complexity?: boolean;
  output?: string;
}

export async function analyzeCommand(targetPath: string = '.', options: AnalyzeOptions): Promise<void> {
  console.log(chalk.cyan('\n🔍 VLLMCode プロジェクト分析\n'));

  const absolutePath = path.isAbsolute(targetPath) 
    ? targetPath 
    : path.join(process.cwd(), targetPath);

  // パスの存在確認
  if (!await fs.pathExists(absolutePath)) {
    console.error(chalk.red(`❌ パスが見つかりません: ${targetPath}`));
    process.exit(1);
  }

  const spinner = ora('プロジェクトを分析しています...').start();

  try {
    const analyzer = new ProjectAnalyzer();
    
    // 分析オプションの設定
    const analyzeOptions = {
      depth: parseInt(options.depth || '3'),
      includeStructure: options.structure !== false,
      includeDependencies: options.dependencies !== false,
      includeStatistics: true,
    };

    // プロジェクト分析を実行
    const analysis = await analyzer.analyzeDirectory(absolutePath, analyzeOptions);
    
    spinner.succeed('分析が完了しました');

    // 結果の表示
    const formattedResult = analyzer.formatAnalysis(analysis);
    console.log('\n' + formattedResult);

    // ファイルへの出力
    if (options.output) {
      await saveAnalysisResult(analysis, options.output);
      console.log(chalk.green(`\n✅ 分析結果を保存しました: ${options.output}`));
    }

    // 複雑度分析（オプション）
    if (options.complexity) {
      await analyzeComplexity(absolutePath);
    }

  } catch (error: any) {
    spinner.fail('分析中にエラーが発生しました');
    console.error(chalk.red('エラー:'), error.message);
    process.exit(1);
  }
}

async function saveAnalysisResult(analysis: any, outputPath: string): Promise<void> {
  const extension = path.extname(outputPath).toLowerCase();
  
  if (extension === '.json') {
    await fs.writeJson(outputPath, analysis, { spaces: 2 });
  } else if (extension === '.md' || extension === '.txt') {
    const analyzer = new ProjectAnalyzer();
    const formatted = analyzer.formatAnalysis(analysis);
    await fs.writeFile(outputPath, formatted, 'utf-8');
  } else {
    // デフォルトはJSON
    await fs.writeJson(outputPath, analysis, { spaces: 2 });
  }
}

async function analyzeComplexity(_projectPath: string): Promise<void> {
  console.log(chalk.cyan('\n📈 複雑度分析:'));
  
  // 簡易的な複雑度分析の実装
  // const _metrics = {
  //   cyclomaticComplexity: 0,
  //   cognitiveComplexity: 0,
  //   nestingLevel: 0,
  // };

  // TODO: より詳細な複雑度分析の実装
  console.log(chalk.gray('  （詳細な複雑度分析は今後実装予定）'));
}
