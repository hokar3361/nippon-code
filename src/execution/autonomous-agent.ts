import { OpenAIProvider } from '../providers/openai';
import { config } from '../config';
import { fileOperations } from './file-operations';
import { commandRunner } from './command-runner';
import chalk from 'chalk';

export interface Action {
  type: 'create_file' | 'update_file' | 'run_command' | 'read_file' | 'complete' | 'error';
  fileName?: string;
  content?: string;
  command?: string;
  message?: string;
  rawResponse?: string;
}

export interface ExecutionContext {
  userRequest: string;
  executionHistory: string[];
  createdFiles: string[];
  lastError?: string;
  currentDirectory: string;
}

export class AutonomousAgent {
  private aiProvider: OpenAIProvider;
  private maxIterations = 30; // 無限ループ防止
  private debug = false;

  constructor() {
    this.aiProvider = new OpenAIProvider(
      config.get('apiKey'),
      config.get('apiBaseUrl'),
      config.get('model')
    );
  }

  async executeRequest(userRequest: string): Promise<void> {
    const context: ExecutionContext = {
      userRequest,
      executionHistory: [],
      createdFiles: [],
      currentDirectory: process.cwd()
    };

    console.log(chalk.cyan('\n🤖 AI自律エージェントを起動します...'));
    console.log(chalk.gray(`要求: ${userRequest}\n`));

    let iteration = 0;
    let completed = false;

    while (!completed && iteration < this.maxIterations) {
      iteration++;
      
      try {
        // 1. AIに次のアクションを聞く
        console.log(chalk.gray(`\n[Step ${iteration}] 次のアクションを決定中...`));
        const action = await this.getNextAction(context);
        
        if (this.debug) {
          console.log(chalk.gray(`[DEBUG] Action: ${JSON.stringify(action)}`));
        }

        // 2. アクションタイプに応じて処理
        if (action.type === 'complete') {
          console.log(chalk.green('\n✅ タスクが完了しました！'));
          if (action.message) {
            console.log(chalk.cyan(action.message));
          }
          completed = true;
          break;
        }

        if (action.type === 'error') {
          console.error(chalk.red(`\n❌ エラー: ${action.message}`));
          context.lastError = action.message;
          continue;
        }

        // 3. アクションを実行
        const result = await this.executeAction(action, context);
        
        // 4. 実行履歴に追加
        context.executionHistory.push(result);
        
        // 5. 結果を表示
        console.log(chalk.green(`✓ ${result}`));
        
      } catch (error) {
        console.error(chalk.red(`\n❌ エラーが発生しました: ${error}`));
        context.lastError = String(error);
        context.executionHistory.push(`エラー: ${error}`);
      }
    }

    if (iteration >= this.maxIterations) {
      console.log(chalk.yellow('\n⚠️ 最大反復回数に達しました。タスクを終了します。'));
    }

    // 最終サマリー表示
    this.showSummary(context);
  }

  private async getNextAction(context: ExecutionContext): Promise<Action> {
    const prompt = this.buildPrompt(context);
    
    const response = await this.aiProvider.complete({
      messages: [{ role: 'user', content: prompt }],
      model: config.get('model'),
      temperature: 0.7,
      maxTokens: 2048
    });

    if (!response.content) {
      throw new Error('AIからの応答がありません');
    }

    return this.extractAction(response.content);
  }

  private buildPrompt(context: ExecutionContext): string {
    const history = context.executionHistory.slice(-10).join('\n');
    const files = context.createdFiles.length > 0 
      ? `作成済みファイル:\n${context.createdFiles.map(f => `- ${f}`).join('\n')}`
      : '';

    return `あなたは段階的にタスクを実行するプログラミングアシスタントです。
ユーザーの要求を満たすため、1つずつアクションを実行していきます。

ユーザー要求: ${context.userRequest}

${files}

実行履歴:
${history || '（まだ何も実行していません）'}

${context.lastError ? `直前のエラー: ${context.lastError}` : ''}

次に実行すべき1つのアクションを以下の形式で回答してください：

【アクションタイプを選択】
- CREATE_FILE: 新しいファイルを作成
- UPDATE_FILE: 既存ファイルを更新
- RUN_COMMAND: コマンドを実行
- READ_FILE: ファイルを読み込み
- COMPLETE: タスク完了
- ERROR: エラーで続行不可

【回答形式】
ACTION: [アクションタイプ]
FILE: [ファイル名]（ファイル操作の場合）
COMMAND: [実行コマンド]（コマンド実行の場合）
CONTENT:
\`\`\`[言語]
[ファイル内容またはコード]
\`\`\`
MESSAGE: [ユーザーへのメッセージ]

重要：
1. 一度に1つのアクションのみ
2. ファイルは1つずつ作成
3. 長いコードも省略せず完全に出力
4. ユーザーの要求が満たされたらCOMPLETEを選択`;
  }

  private extractAction(aiResponse: string): Action {
    const action: Action = {
      type: 'error',
      rawResponse: aiResponse
    };

    // アクションタイプの抽出
    const actionMatch = aiResponse.match(/ACTION:\s*([A-Z_]+)/);
    if (actionMatch) {
      const actionType = actionMatch[1].toLowerCase().replace('_', '_');
      switch (actionType) {
        case 'create_file':
          action.type = 'create_file';
          break;
        case 'update_file':
          action.type = 'update_file';
          break;
        case 'run_command':
          action.type = 'run_command';
          break;
        case 'read_file':
          action.type = 'read_file';
          break;
        case 'complete':
          action.type = 'complete';
          break;
        default:
          action.type = 'error';
      }
    }

    // ファイル名の抽出
    const fileMatch = aiResponse.match(/FILE:\s*(.+?)(?:\n|$)/);
    if (fileMatch) {
      action.fileName = fileMatch[1].trim();
    }

    // コマンドの抽出
    const commandMatch = aiResponse.match(/COMMAND:\s*(.+?)(?:\n|$)/);
    if (commandMatch) {
      action.command = commandMatch[1].trim();
    }

    // コンテンツの抽出（コードブロック）
    const contentMatch = aiResponse.match(/CONTENT:\s*\n```[\w]*\n([\s\S]*?)```/);
    if (contentMatch) {
      action.content = contentMatch[1].trim();
    }

    // メッセージの抽出
    const messageMatch = aiResponse.match(/MESSAGE:\s*(.+?)(?:\n|$)/);
    if (messageMatch) {
      action.message = messageMatch[1].trim();
    }

    // フォールバック：コードブロックがある場合
    if (!action.content && aiResponse.includes('```')) {
      const codeBlockMatch = aiResponse.match(/```[\w]*\n([\s\S]*?)```/);
      if (codeBlockMatch) {
        action.content = codeBlockMatch[1].trim();
        
        // ファイル名を推測
        if (!action.fileName && action.type === 'create_file') {
          const possibleFileMatch = aiResponse.match(/(\w+\.\w+)/);
          if (possibleFileMatch) {
            action.fileName = possibleFileMatch[1];
          }
        }
      }
    }

    return action;
  }

  private async executeAction(action: Action, context: ExecutionContext): Promise<string> {
    switch (action.type) {
      case 'create_file':
        if (!action.fileName || !action.content) {
          throw new Error('ファイル名またはコンテンツが指定されていません');
        }
        await fileOperations.writeFile(action.fileName, action.content);
        context.createdFiles.push(action.fileName);
        return `ファイル作成: ${action.fileName}`;

      case 'update_file':
        if (!action.fileName || !action.content) {
          throw new Error('ファイル名またはコンテンツが指定されていません');
        }
        await fileOperations.writeFile(action.fileName, action.content);
        return `ファイル更新: ${action.fileName}`;

      case 'run_command':
        if (!action.command) {
          throw new Error('コマンドが指定されていません');
        }
        console.log(chalk.gray(`  実行中: ${action.command}`));
        const result = await commandRunner.run(action.command, { 
          silent: false,
          timeout: 30000 
        });
        
        if (!result.success) {
          throw new Error(`コマンド失敗: ${result.stderr}`);
        }
        return `コマンド実行: ${action.command}`;

      case 'read_file':
        if (!action.fileName) {
          throw new Error('ファイル名が指定されていません');
        }
        const content = await fileOperations.readFile(action.fileName);
        context.executionHistory.push(`ファイル読み込み: ${action.fileName}\n内容:\n${content.substring(0, 500)}...`);
        return `ファイル読み込み: ${action.fileName}`;

      default:
        throw new Error(`未知のアクションタイプ: ${action.type}`);
    }
  }

  private showSummary(context: ExecutionContext): void {
    console.log(chalk.cyan('\n📊 実行サマリー'));
    console.log(chalk.cyan('═'.repeat(50)));
    
    if (context.createdFiles.length > 0) {
      console.log(chalk.white('\n作成されたファイル:'));
      context.createdFiles.forEach(file => {
        console.log(chalk.green(`  ✓ ${file}`));
      });
    }

    console.log(chalk.white(`\n実行ステップ数: ${context.executionHistory.length}`));
    
    if (context.lastError) {
      console.log(chalk.yellow(`\n最後のエラー: ${context.lastError}`));
    }

    console.log(chalk.cyan('═'.repeat(50)));
  }

  setDebug(enabled: boolean): void {
    this.debug = enabled;
  }
}

export const autonomousAgent = new AutonomousAgent();