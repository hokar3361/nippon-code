import chalk from 'chalk';
import readline from 'readline';
import { config } from '../config';
import { SimpleChatAgent } from '../agents/simple-chat';
import { displayBanner, displayCompactBanner } from '../utils/ascii-art';
import { SimpleSessionManager } from '../session/simple-manager';
import fs from 'fs-extra';
import path from 'path';
import { globSync } from 'glob';
import { TaskPlanner } from '../planning/planner';
import { TaskManager } from '../planning/task-manager';
import { TaskExecutor } from '../execution/executor';
import { ProgressTracker } from '../execution/progress-tracker';
import { TaskPlan, DetailedTask } from '../planning/interfaces';

interface ChatProfile {
  name: string;
  apiKey: string;
  apiBaseUrl: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export class InteractiveChat {
  private rl: readline.Interface;
  private agent: SimpleChatAgent;
  private sessionManager: SimpleSessionManager;
  private currentProfile: ChatProfile;
  private profiles: Map<string, ChatProfile>;
  private running: boolean = true;
  private projectContext: string = '';
  private isProcessing: boolean = false;
  private taskPlanner: TaskPlanner;
  private taskManager: TaskManager;
  private taskExecutor: TaskExecutor;
  private progressTracker: ProgressTracker;
  private currentPlan: TaskPlan | null = null;
  private safeMode: boolean = false;

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: this.getPrompt(),
    });
    
    this.sessionManager = new SimpleSessionManager();
    this.profiles = new Map();
    this.loadProfiles();
    this.loadProjectContext();
    
    // デフォルトプロファイル設定
    this.currentProfile = this.profiles.get('default') || this.createDefaultProfile();
    this.agent = new SimpleChatAgent(this.currentProfile.model);
    
    // タスク管理システムの初期化
    this.taskPlanner = new TaskPlanner();
    this.taskManager = new TaskManager();
    this.progressTracker = new ProgressTracker();
    this.taskExecutor = new TaskExecutor(this.taskManager);
    
    // イベントリスナーの設定
    this.setupEventListeners();
  }

  private createDefaultProfile(): ChatProfile {
    return {
      name: 'default',
      apiKey: config.get('apiKey'),
      apiBaseUrl: config.get('apiBaseUrl'),
      model: config.get('model'),
      temperature: config.get('temperature'),
      maxTokens: config.get('maxTokens'),
    };
  }

  private loadProfiles(): void {
    const configPath = path.join(process.cwd(), '.nipponcode', 'profiles.json');
    
    if (fs.existsSync(configPath)) {
      try {
        const profilesData = fs.readJsonSync(configPath);
        for (const [name, profile] of Object.entries(profilesData)) {
          this.profiles.set(name, profile as ChatProfile);
        }
      } catch (error) {
        console.warn(chalk.yellow('プロファイルの読み込みに失敗しました'));
      }
    }
    
    // デフォルトプロファイルを必ず設定
    if (!this.profiles.has('default')) {
      this.profiles.set('default', this.createDefaultProfile());
    }
  }

  private async saveProfiles(): Promise<void> {
    const configDir = path.join(process.cwd(), '.nipponcode');
    await fs.ensureDir(configDir);
    
    const profilesData: Record<string, ChatProfile> = {};
    for (const [name, profile] of this.profiles.entries()) {
      profilesData[name] = profile;
    }
    
    await fs.writeJson(path.join(configDir, 'profiles.json'), profilesData, { spaces: 2 });
  }

  private loadProjectContext(): void {
    // プロジェクトディレクトリの.mdファイルを読み込む
    const projectDir = process.cwd();
    const nipponCodeDir = path.join(projectDir, '.nipponcode');
    
    if (!fs.existsSync(nipponCodeDir)) {
      return;
    }
    
    // NIPPONCODE.md または PROJECT.md を優先的に読み込む
    const contextFiles = ['NIPPONCODE.md', 'PROJECT.md', 'README.md'];
    
    for (const fileName of contextFiles) {
      const filePath = path.join(projectDir, fileName);
      if (fs.existsSync(filePath)) {
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          this.projectContext += `\n## ${fileName}\n${content}\n`;
        } catch (error) {
          console.warn(chalk.yellow(`${fileName}の読み込みに失敗しました`));
        }
      }
    }
    
    // その他の.mdファイルも読み込む
    const mdFiles = globSync('*.md', { 
      cwd: projectDir,
      ignore: contextFiles,
    });
    
    for (const mdFile of mdFiles.slice(0, 5)) { // 最大5ファイルまで
      try {
        const content = fs.readFileSync(path.join(projectDir, mdFile), 'utf8');
        this.projectContext += `\n## ${mdFile}\n${content.substring(0, 1000)}...\n`; // 各ファイル1000文字まで
      } catch (error) {
        // エラーは無視
      }
    }
  }

  public async start(): Promise<void> {
    displayBanner();
    
    if (this.projectContext) {
      console.log(chalk.gray('📁 プロジェクトコンテキストを読み込みました'));
    }
    
    console.log(chalk.yellow('\n💬 対話モードを開始しました'));
    console.log(chalk.gray('終了: /exit または Ctrl+C'));
    console.log(chalk.gray('ヘルプ: /help\n'));
    
    this.rl.prompt();
    
    this.rl.on('line', async (input) => {
      if (!this.running) return;
      
      const trimmedInput = input.trim();
      
      if (trimmedInput.startsWith('/')) {
        await this.handleCommand(trimmedInput);
      } else if (trimmedInput) {
        await this.handleMessage(trimmedInput);
      }
      
      if (this.running) {
        this.rl.setPrompt(this.getPrompt());
        this.rl.prompt();
      }
    });
    
    this.rl.on('close', () => {
      this.exit();
    });
    
    // プロセス終了時のクリーンアップ
    process.on('SIGINT', () => {
      this.exit();
    });
  }

  private async handleCommand(command: string): Promise<void> {
    const [cmd, ...args] = command.split(' ');
    
    switch (cmd.toLowerCase()) {
      case '/help':
        this.showHelp();
        break;
        
      case '/exit':
      case '/quit':
        this.exit();
        break;
        
      case '/clear':
        console.clear();
        displayCompactBanner();
        break;
        
      case '/profile':
        await this.handleProfileCommand(args);
        break;
        
      case '/model':
        if (args.length > 0) {
          this.currentProfile.model = args.join(' ');
          this.agent = new SimpleChatAgent(this.currentProfile.model);
          console.log(chalk.green(`✓ モデルを${this.currentProfile.model}に変更しました`));
        } else {
          console.log(chalk.cyan(`現在のモデル: ${this.currentProfile.model}`));
        }
        break;
        
      case '/session':
        await this.handleSessionCommand(args);
        break;
        
      case '/context':
        this.showContext();
        break;
        
      case '/reload':
        this.loadProjectContext();
        console.log(chalk.green('✓ プロジェクトコンテキストを再読み込みしました'));
        break;
        
      case '/config':
        this.showConfig();
        break;
        
      case '/save':
        await this.saveSession();
        break;
        
      case '/plan':
        await this.handlePlanCommand(args);
        break;
        
      case '/approve':
        await this.approvePlan();
        break;
        
      case '/skip':
        await this.skipCurrentTask();
        break;
        
      case '/rollback':
        await this.rollbackLastTask();
        break;
        
      case '/safe-mode':
        this.toggleSafeMode();
        break;
        
      default:
        console.log(chalk.red(`不明なコマンド: ${cmd}`));
        console.log(chalk.gray('/help でコマンド一覧を表示'));
    }
  }

  private async handleProfileCommand(args: string[]): Promise<void> {
    if (args.length === 0) {
      // プロファイル一覧表示
      console.log(chalk.cyan('\n📋 プロファイル一覧:'));
      for (const [name, profile] of this.profiles.entries()) {
        const current = name === this.currentProfile.name ? ' (現在)' : '';
        console.log(chalk.white(`  - ${name}${current}`));
        console.log(chalk.gray(`    Model: ${profile.model}`));
        console.log(chalk.gray(`    API: ${profile.apiBaseUrl}`));
      }
      return;
    }
    
    const subCommand = args[0];
    
    switch (subCommand) {
      case 'switch':
        if (args.length < 2) {
          console.log(chalk.red('プロファイル名を指定してください'));
          return;
        }
        const profileName = args[1];
        if (this.profiles.has(profileName)) {
          this.currentProfile = this.profiles.get(profileName)!;
          config.set('apiKey', this.currentProfile.apiKey);
          config.set('apiBaseUrl', this.currentProfile.apiBaseUrl);
          config.set('model', this.currentProfile.model);
          this.agent = new SimpleChatAgent(this.currentProfile.model);
          console.log(chalk.green(`✓ プロファイルを${profileName}に切り替えました`));
        } else {
          console.log(chalk.red(`プロファイル'${profileName}'が見つかりません`));
        }
        break;
        
      case 'add':
        if (args.length < 2) {
          console.log(chalk.red('プロファイル名を指定してください'));
          return;
        }
        // 簡易的な追加（実際はインタラクティブに入力を求めるべき）
        console.log(chalk.yellow('新しいプロファイルの作成は init コマンドを使用してください'));
        break;
        
      case 'delete':
        if (args.length < 2) {
          console.log(chalk.red('プロファイル名を指定してください'));
          return;
        }
        const delName = args[1];
        if (delName === 'default') {
          console.log(chalk.red('デフォルトプロファイルは削除できません'));
          return;
        }
        if (this.profiles.delete(delName)) {
          await this.saveProfiles();
          console.log(chalk.green(`✓ プロファイル'${delName}'を削除しました`));
        } else {
          console.log(chalk.red(`プロファイル'${delName}'が見つかりません`));
        }
        break;
        
      default:
        console.log(chalk.red(`不明なサブコマンド: ${subCommand}`));
    }
  }

  private async handleSessionCommand(args: string[]): Promise<void> {
    if (args.length === 0) {
      const sessions = await this.sessionManager.listSessions();
      console.log(chalk.cyan('\n📂 セッション一覧:'));
      sessions.forEach(session => {
        console.log(chalk.white(`  - ${session.id} (${new Date(session.createdAt).toLocaleString('ja-JP')})`));
      });
      return;
    }
    
    const subCommand = args[0];
    
    switch (subCommand) {
      case 'load':
        if (args.length < 2) {
          console.log(chalk.red('セッションIDを指定してください'));
          return;
        }
        const sessionId = args[1];
        const session = await this.sessionManager.loadSession(sessionId);
        if (session) {
          console.log(chalk.green(`✓ セッション'${sessionId}'を読み込みました`));
        } else {
          console.log(chalk.red(`セッション'${sessionId}'が見つかりません`));
        }
        break;
        
      case 'new':
        await this.sessionManager.createSession();
        console.log(chalk.green('✓ 新しいセッションを作成しました'));
        break;
        
      default:
        console.log(chalk.red(`不明なサブコマンド: ${subCommand}`));
    }
  }

  private async handleMessage(message: string): Promise<void> {
    if (this.isProcessing) {
      console.log(chalk.yellow('\n⚠️  まだ処理中です...'));
      return;
    }
    
    this.isProcessing = true;
    
    try {
      // プロジェクトコンテキストを含めてメッセージを送信
      const contextualMessage = this.projectContext 
        ? `[プロジェクトコンテキスト]\n${this.projectContext}\n\n[ユーザーメッセージ]\n${message}`
        : message;
      
      // Processingアニメーションを開始
      const spinner = this.startProcessingAnimation();
      
      let fullResponse = '';
      
      // ストリーミングが有効な場合も、全て受信してから表示
      if (this.agent.isStreaming()) {
        for await (const chunk of this.agent.streamChat(contextualMessage)) {
          fullResponse += chunk;
        }
      } else {
        fullResponse = await this.agent.chat(contextualMessage);
      }
      
      // アニメーションを停止
      clearInterval(spinner);
      process.stdout.write('\r' + ' '.repeat(50) + '\r');  // アニメーションをクリア
      
      // レスポンスを表示
      console.log('\n' + chalk.cyan('🤖 NipponCode:'));
      console.log(fullResponse);
      console.log();
      
      // セッションに保存
      await this.sessionManager.addMessage({ role: 'user', content: message });
      await this.sessionManager.addMessage({ role: 'assistant', content: fullResponse });
      
    } catch (error: any) {
      console.error(chalk.red('\n❌ エラー:'), error.message);
      console.log();
    } finally {
      this.isProcessing = false;
    }
  }
  
  private startProcessingAnimation(): NodeJS.Timeout {
    const frames = ['⏳ Processing.  ', '⏳ Processing.. ', '⏳ Processing...'];
    let i = 0;
    
    return setInterval(() => {
      process.stdout.write('\r' + chalk.gray(frames[i]));
      i = (i + 1) % frames.length;
    }, 300);
  }

  private showHelp(): void {
    console.log(chalk.cyan('\n📚 コマンド一覧:\n'));
    console.log(chalk.white('  /help           - このヘルプを表示'));
    console.log(chalk.white('  /exit, /quit    - 対話モードを終了'));
    console.log(chalk.white('  /clear          - 画面をクリア'));
    console.log(chalk.white('  /profile        - プロファイル管理'));
    console.log(chalk.white('    /profile                 - プロファイル一覧'));
    console.log(chalk.white('    /profile switch <name>   - プロファイル切替'));
    console.log(chalk.white('    /profile delete <name>   - プロファイル削除'));
    console.log(chalk.white('  /model <name>   - モデルを変更'));
    console.log(chalk.white('  /session        - セッション管理'));
    console.log(chalk.white('    /session                 - セッション一覧'));
    console.log(chalk.white('    /session load <id>       - セッション読込'));
    console.log(chalk.white('    /session new             - 新規セッション'));
    console.log(chalk.white('  /context        - プロジェクトコンテキスト表示'));
    console.log(chalk.white('  /reload         - コンテキスト再読み込み'));
    console.log(chalk.white('  /config         - 現在の設定を表示'));
    console.log(chalk.white('  /save           - セッションを保存'));
    console.log(chalk.cyan('\n🚀 高度な機能:\n'));
    console.log(chalk.white('  /plan [request] - 実行計画を作成'));
    console.log(chalk.white('  /approve        - 現在の計画を承認・実行'));
    console.log(chalk.white('  /skip           - 現在のタスクをスキップ'));
    console.log(chalk.white('  /rollback       - 直前の変更を取り消し'));
    console.log(chalk.white('  /safe-mode      - セーフモードを切り替え'));
    console.log();
  }

  private showContext(): void {
    if (this.projectContext) {
      console.log(chalk.cyan('\n📄 プロジェクトコンテキスト:'));
      console.log(chalk.gray(this.projectContext.substring(0, 500) + '...'));
    } else {
      console.log(chalk.yellow('プロジェクトコンテキストが読み込まれていません'));
    }
  }

  private showConfig(): void {
    console.log(chalk.cyan('\n⚙️  現在の設定:'));
    console.log(chalk.white(`  プロファイル: ${this.currentProfile.name}`));
    console.log(chalk.white(`  モデル: ${this.currentProfile.model}`));
    console.log(chalk.white(`  API URL: ${this.currentProfile.apiBaseUrl}`));
    console.log(chalk.white(`  温度: ${this.currentProfile.temperature || 0.7}`));
    console.log(chalk.white(`  最大トークン: ${this.currentProfile.maxTokens || 4096}`));
    console.log();
  }

  private async saveSession(): Promise<void> {
    await this.sessionManager.saveSession();
    console.log(chalk.green('✓ セッションを保存しました'));
  }

  private getPrompt(): string {
    if (this.isProcessing) {
      return chalk.gray('⏳ ');
    }
    return chalk.gray('╭─') + chalk.cyan('[NipponCode]') + chalk.gray('─╮\n╰─➤ ');
  }
  
  private exit(): void {
    this.running = false;
    console.log(chalk.yellow('\n👋 さようなら！'));
    this.rl.close();
    process.exit(0);
  }

  private setupEventListeners(): void {
    // タスクマネージャーのイベント
    this.taskManager.on('task:statusChanged', ({ taskId, newStatus, task }) => {
      this.progressTracker.updateTaskStatus(taskId, newStatus, task.name);
    });

    this.taskManager.on('task:progress', (update) => {
      this.progressTracker.updateProgress(update);
    });

    this.taskManager.on('task:completed', (result) => {
      this.progressTracker.completeTask(
        result.taskId,
        result.status === 'success' ? 'success' : 'failure'
      );
    });

    // タスクエグゼキューターのイベント
    this.taskExecutor.on('approval:required', async ({ step }) => {
      console.log(chalk.yellow(`\n⚠️ 承認が必要です: ${step.description}`));
      console.log(chalk.gray(`安全レベル: ${step.safetyLevel}`));
      
      if (this.safeMode) {
        const answer = await this.askQuestion('実行しますか？ (y/n): ');
        this.taskExecutor.emit('approval:response', answer.toLowerCase() === 'y');
      } else {
        console.log(chalk.green('自動承認（セーフモードではありません）'));
        this.taskExecutor.emit('approval:response', true);
      }
    });

    this.taskExecutor.on('log', (entry) => {
      if (entry.level === 'error') {
        console.log(chalk.red(`[${entry.level}] ${entry.message}`));
      } else if (entry.level === 'warning') {
        console.log(chalk.yellow(`[${entry.level}] ${entry.message}`));
      }
    });
  }

  private async handlePlanCommand(args: string[]): Promise<void> {
    if (args.length === 0) {
      if (this.currentPlan) {
        console.log(this.taskPlanner.formatPlanForDisplay(this.currentPlan));
      } else {
        console.log(chalk.yellow('現在の計画はありません。リクエストを指定してください。'));
      }
      return;
    }

    const request = args.join(' ');
    console.log(chalk.cyan('📋 実行計画を作成中...'));
    
    try {
      const plan = await this.taskPlanner.analyzeRequest(request);
      const validation = await this.taskPlanner.validatePlan(plan);
      
      if (!validation.valid) {
        console.log(chalk.red('計画の検証に失敗しました:'));
        validation.errors.forEach(err => console.log(chalk.red(`  - ${err}`)));
        return;
      }

      if (validation.warnings.length > 0) {
        console.log(chalk.yellow('警告:'));
        validation.warnings.forEach(warn => console.log(chalk.yellow(`  - ${warn}`)));
      }

      this.currentPlan = plan;
      this.taskManager.registerPlan(plan);
      
      console.log(this.taskPlanner.formatPlanForDisplay(plan));
      console.log(chalk.green('\n✓ 計画が作成されました。/approve で実行します。'));
      
    } catch (error: any) {
      console.log(chalk.red(`計画の作成に失敗しました: ${error.message}`));
    }
  }

  private async approvePlan(): Promise<void> {
    if (!this.currentPlan) {
      console.log(chalk.yellow('承認する計画がありません。先に /plan で計画を作成してください。'));
      return;
    }

    if (this.currentPlan.approved) {
      console.log(chalk.yellow('この計画は既に承認されています。'));
      return;
    }

    this.taskManager.approvePlan(this.currentPlan.id);
    console.log(chalk.green('✓ 計画を承認しました。実行を開始します...'));
    
    await this.executePlan();
  }

  private async executePlan(): Promise<void> {
    if (!this.currentPlan) return;

    const tasks = this.taskPlanner.getExecutionOrder(this.currentPlan.tasks);
    this.progressTracker.displayPlanSummary(tasks);
    this.progressTracker.displayTaskList(tasks);

    let successCount = 0;
    let failureCount = 0;
    let skippedCount = 0;
    const startTime = Date.now();

    for (const task of tasks) {
      const nextTask = this.taskManager.getNextPendingTask(this.currentPlan.id);
      if (!nextTask) continue;

      if (nextTask.id !== task.id) {
        console.log(chalk.yellow(`依存関係によりタスク ${task.name} をスキップ`));
        skippedCount++;
        continue;
      }

      this.progressTracker.startTask(task);
      
      try {
        // 簡易的な実行（Phase 1では詳細実装をスキップ）
        const detailedTask: DetailedTask = {
          ...task,
          parentId: '',
          order: 0,
          steps: [{
            id: `step-${task.id}`,
            description: task.description,
            requiresApproval: this.safeMode,
            safetyLevel: 'safe'
          }],
          resources: [],
          risks: []
        };

        const result = await this.taskExecutor.executeTask(detailedTask);
        
        if (result.status === 'success') {
          successCount++;
        } else {
          failureCount++;
        }
      } catch (error: any) {
        console.log(chalk.red(`タスク実行エラー: ${error.message}`));
        failureCount++;
      }
    }

    const totalDuration = Date.now() - startTime;
    this.progressTracker.displayCompletionSummary(
      successCount,
      failureCount,
      skippedCount,
      totalDuration
    );

    this.currentPlan = null;
  }

  private async skipCurrentTask(): Promise<void> {
    const activeTask = this.taskManager.getActiveTask();
    if (!activeTask) {
      console.log(chalk.yellow('スキップするアクティブなタスクがありません。'));
      return;
    }

    this.taskManager.skipTask(activeTask.id, 'ユーザーリクエスト');
    console.log(chalk.green(`✓ タスク "${activeTask.name}" をスキップしました。`));
  }

  private async rollbackLastTask(): Promise<void> {
    console.log(chalk.yellow('⚠️ ロールバック機能は Phase 3 で実装予定です。'));
  }

  private toggleSafeMode(): void {
    this.safeMode = !this.safeMode;
    console.log(chalk.green(`✓ セーフモード: ${this.safeMode ? 'ON' : 'OFF'}`));
    if (this.safeMode) {
      console.log(chalk.yellow('すべての危険な操作で確認が必要になります。'));
    }
  }

  private askQuestion(question: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(chalk.cyan(question), (answer) => {
        resolve(answer);
      });
    });
  }
}