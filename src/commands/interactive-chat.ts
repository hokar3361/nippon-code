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
import { ExecutionFlow } from '../execution/execution-flow';
import { CommandExecutor } from '../execution/command-executor';
import { TaskPlan, Permission } from '../planning/interfaces';

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
  private executionFlow: ExecutionFlow | null = null;
  private commandExecutor: CommandExecutor;
  private currentPlan: TaskPlan | null = null;
  private safeMode: boolean = false;
  // @ts-ignore - Used for state tracking in plan operations
  private _planMode: boolean = false;

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
    this.commandExecutor = new CommandExecutor();
    
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
        
      case '/execute':
        await this.executePlan();
        break;
        
      case '/abort':
        this.abortExecution();
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
  
  private startProcessingAnimation(message: string = 'Processing'): NodeJS.Timeout {
    const frames = [`⏳ ${message}.  `, `⏳ ${message}.. `, `⏳ ${message}...`];
    let i = 0;
    
    return setInterval(() => {
      process.stdout.write('\r' + chalk.gray(frames[i]));
      i = (i + 1) % frames.length;
    }, 300);
  }
  
  private stopProcessingAnimation(timer: NodeJS.Timeout): void {
    clearInterval(timer);
    process.stdout.write('\r' + ' '.repeat(50) + '\r');
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
    console.log(chalk.cyan('\n🚀 インテリジェント実行コマンド:'));
    console.log(chalk.white('  /plan [task]    - タスクの実行計画を作成'));
    console.log(chalk.white('  /approve        - 計画を承認'));
    console.log(chalk.white('  /execute        - 計画を実行'));
    console.log(chalk.white('  /skip           - 現在のタスクをスキップ'));
    console.log(chalk.white('  /rollback       - 直前の変更を取り消し'));
    console.log(chalk.white('  /safe-mode      - セーフモードの切り替え'));
    console.log(chalk.white('  /abort          - 実行を中止'));
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
    // Command executor events
    this.commandExecutor.on('permission:required', (data) => {
      console.log(chalk.yellow(`\n⚠️ コマンド実行の許可が必要です: ${data.command}`));
      console.log(chalk.yellow('実行しますか？ (yes/no/always/never):'));
      
      this.rl.question('', (answer) => {
        const permission = answer.toLowerCase() as Permission;
        if (['yes', 'no', 'always', 'never'].includes(permission)) {
          data.callback(permission);
        } else {
          data.callback('no');
        }
      });
    });
    
    this.commandExecutor.on('danger:confirmation', (data) => {
      console.log(chalk.red(`\n⚠️ 危険な操作です: ${data.command}`));
      console.log(chalk.red(`目的: ${data.intent.purpose}`));
      console.log(chalk.red('本当に実行しますか？ (yes/no):'));
      
      this.rl.question('', (answer) => {
        data.callback(answer.toLowerCase() === 'yes');
      });
    });
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
    
    // Enter plan mode
    this._planMode = true;
    console.log(chalk.cyan('\n📋 プランモードに入りました...'));
    
    const request = args.join(' ');
    const spinner = this.startProcessingAnimation('計画を作成中...');
    
    try {
      // Create intelligent execution flow
      this.executionFlow = new ExecutionFlow({
        autoApprove: false,
        verbose: true,
        dryRun: this.safeMode
      });
      
      this.setupExecutionFlowEvents();
      
      // Analyze request and create plan
      this.currentPlan = await this.taskPlanner.analyzeRequest(request);
      
      // Validate plan
      const validation = await this.taskPlanner.validatePlan(this.currentPlan);
      
      this.stopProcessingAnimation(spinner);
      
      // Display plan
      console.log(this.taskPlanner.formatPlanForDisplay(this.currentPlan));
      
      if (validation.warnings.length > 0) {
        console.log(chalk.yellow('\n⚠️ 警告:'));
        validation.warnings.forEach(w => console.log(chalk.yellow(`  - ${w}`)));
      }
      
      if (validation.suggestions && validation.suggestions.length > 0) {
        console.log(chalk.cyan('\n💡 提案:'));
        validation.suggestions.forEach(s => console.log(chalk.cyan(`  - ${s}`)));
      }
      
      console.log(chalk.green('\n✓ 計画が作成されました。/approve で承認、/execute で実行します。'));
      
    } catch (error) {
      this.stopProcessingAnimation(spinner);
      console.error(chalk.red(`\n❌ 計画作成エラー: ${error}`));
      this._planMode = false;
    }
  }
  
  private async approvePlan(): Promise<void> {
    if (!this.currentPlan) {
      console.log(chalk.red('承認する計画がありません'));
      return;
    }
    
    this.currentPlan.approved = true;
    this.currentPlan.approvedAt = new Date();
    
    if (this.executionFlow) {
      this.executionFlow.approve();
    }
    
    console.log(chalk.green('✓ 計画が承認されました'));
  }
  
  private async executePlan(): Promise<void> {
    if (!this.currentPlan) {
      console.log(chalk.red('実行する計画がありません'));
      return;
    }
    
    if (!this.currentPlan.approved) {
      console.log(chalk.yellow('計画がまだ承認されていません。/approve で承認してください'));
      return;
    }
    
    if (!this.executionFlow) {
      this.executionFlow = new ExecutionFlow({
        autoApprove: !this.safeMode,
        verbose: true,
        dryRun: false
      });
      this.setupExecutionFlowEvents();
    }
    
    try {
      console.log(chalk.cyan('\n🚀 実行を開始します...'));
      const result = await this.executionFlow.execute(this.currentPlan.userRequest);
      
      console.log(chalk.green(`\n✅ 実行完了!`));
      console.log(chalk.white(`成功率: ${(result.successRate * 100).toFixed(1)}%`));
      console.log(chalk.white(`総実行時間: ${result.totalDuration}ms`));
      
      // Clear plan after execution
      this.currentPlan = null;
      this.executionFlow = null;
      this._planMode = false;
      
    } catch (error) {
      console.error(chalk.red(`\n❌ 実行エラー: ${error}`));
    }
  }
  
  private async skipCurrentTask(): Promise<void> {
    if (!this.executionFlow) {
      console.log(chalk.red('実行中のフローがありません'));
      return;
    }
    
    // Get current task from flow state
    const state = this.executionFlow.getState();
    const currentTask = state.plan?.tasks.find(t => t.status === 'executing');
    
    if (currentTask) {
      this.executionFlow.skipTask(currentTask.id);
      console.log(chalk.yellow(`⏭️ タスク「${currentTask.name}」をスキップしました`));
    } else {
      console.log(chalk.red('スキップできるタスクがありません'));
    }
  }
  
  private async rollbackLastTask(): Promise<void> {
    if (this.commandExecutor) {
      // Get last executed command
      const history = this.commandExecutor.getExecutionHistory();
      if (history.length > 0) {
        const lastCommand = history[history.length - 1];
        console.log(chalk.yellow(`⏪ ロールバック: ${lastCommand.command}`));
        // Implementation would require snapshot management
        console.log(chalk.yellow('ロールバック機能は実装中です'));
      } else {
        console.log(chalk.red('ロールバックできる操作がありません'));
      }
    }
  }
  
  private toggleSafeMode(): void {
    this.safeMode = !this.safeMode;
    console.log(chalk.cyan(`🔒 セーフモード: ${this.safeMode ? 'ON' : 'OFF'}`));
    
    if (this.safeMode) {
      console.log(chalk.yellow('全ての危険な操作で確認が必要になります'));
    }
  }
  
  private abortExecution(): void {
    if (this.executionFlow) {
      this.executionFlow.abort();
      console.log(chalk.red('⛔ 実行を中止しました'));
      this.executionFlow = null;
      this._planMode = false;
    } else {
      console.log(chalk.red('中止する実行がありません'));
    }
  }
  
  private setupExecutionFlowEvents(): void {
    if (!this.executionFlow) return;
    
    this.executionFlow.on('phase:started', (data) => {
      this.progressTracker.setCurrentPhase(data.phase);
    });
    
    this.executionFlow.on('task:started', (data) => {
      console.log(chalk.cyan(`\n🚀 タスク開始: ${data.name}`));
    });
    
    this.executionFlow.on('task:completed', (data) => {
      console.log(chalk.green(`✓ タスク完了: ${data.id} (${data.duration}ms)`));
    });
    
    this.executionFlow.on('progress', (update) => {
      this.progressTracker.updateProgress(update);
    });
    
    this.executionFlow.on('approval:required', (data) => {
      console.log(chalk.yellow(`\n⚠️ 承認が必要です: ${data.step.description}`));
      console.log(chalk.yellow('承認するには /approve を入力してください'));
    });
    
    this.executionFlow.on('completion:report', (data) => {
      console.log(chalk.green('\n' + data.report));
    });
  }
  
  // Old implementations removed - using new versions defined above

  private askQuestion(question: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(chalk.cyan(question), (answer) => {
        resolve(answer);
      });
    });
  }
}