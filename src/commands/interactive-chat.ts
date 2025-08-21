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
import { AsyncCommandExecutor } from '../execution/async-command-executor';
import { TaskPlan, Permission } from '../planning/interfaces';
import { autonomousAgent } from '../execution/autonomous-agent';
import { platformDetector } from '../utils/platform-detector';
import { InputBuffer } from '../utils/input-buffer';
import { ErrorContextTracker } from '../utils/error-context-tracker';

interface ChatProfile {
  name: string;
  apiKey: string;
  apiBaseUrl: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export class InteractiveChat {
  private multilineMode = false;
  private multilineBuffer: string[] = [];
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
  private commandExecutor: AsyncCommandExecutor;
  private currentPlan: TaskPlan | null = null;
  private safeMode: boolean = false;
  // @ts-ignore - Used for state tracking in plan operations
  private _planMode: boolean = false;
  private inputBuffer: InputBuffer;
  private inputStats = { lineCount: 0, startTime: 0 };
  private errorTracker: ErrorContextTracker;
  private lastError: string | null = null;

  private autoSaveInterval: NodeJS.Timeout | null = null;
  private sessionFilePath: string;
  
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
    this.commandExecutor = new AsyncCommandExecutor();
    this.setupCommandExecutorListeners();
    
    // 入力バッファの初期化
    this.inputBuffer = new InputBuffer();
    this.setupInputBufferListeners();
    
    // エラートラッカーの初期化
    this.errorTracker = new ErrorContextTracker();
    this.setupErrorTrackerListeners();
    
    // イベントリスナーの設定
    this.setupEventListeners();
    
    // セッションファイルパスの設定
    const sessionDir = path.join(process.cwd(), '.nipponcode', 'sessions');
    fs.ensureDirSync(sessionDir);
    this.sessionFilePath = path.join(sessionDir, 'current-session.json');
    
    // セッションの復元
    this.restoreSession();
    
    // 自動保存の開始
    this.startAutoSave();
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
    console.log(chalk.gray('ヘルプ: /help'));
    console.log(chalk.cyan('複数行入力: ``` で開始/終了、ペースト対応\n'));
    
    this.rl.prompt();
    
    this.rl.on('line', async (input) => {
      if (!this.running) return;
      
      // 入力統計の更新
      const now = Date.now();
      if (this.inputStats.lineCount === 0) {
        this.inputStats.startTime = now;
      }
      this.inputStats.lineCount++;
      
      // ペースト検出
      const timeSpan = now - this.inputStats.startTime;
      const isPaste = this.inputBuffer.isProbablyPaste(this.inputStats.lineCount, timeSpan);
      
      // 複数行モードの処理
      if (this.multilineMode) {
        // 終了マーカーのチェック
        if (input.trim() === '```') {
          this.multilineMode = false;
          const fullMessage = this.multilineBuffer.join('\n');
          this.multilineBuffer = [];
          
          // 収集したメッセージを処理
          if (fullMessage.trim()) {
            if (fullMessage.trim().startsWith('/')) {
              await this.handleCommand(fullMessage.trim());
            } else {
              await this.handleMessage(fullMessage);
            }
          }
          
          // プロンプトを戻す
          this.rl.setPrompt(this.getPrompt());
        } else {
          // バッファに追加
          this.multilineBuffer.push(input);
          this.rl.setPrompt(chalk.gray('... '));
        }
      } else {
        // 複数行モードの開始チェック
        if (input.trim() === '```') {
          this.multilineMode = true;
          this.multilineBuffer = [];
          console.log(chalk.gray('📝 複数行入力モード (終了: ```)。コピペ対応。'));
          this.rl.setPrompt(chalk.gray('... '));
        } else if (isPaste || this.inputBuffer.getBufferSize() > 0) {
          // ペーストまたはバッファリング中の入力
          this.inputBuffer.addInput(input);
          // バッファがフラッシュされるまで待機
        } else {
          // 通常の処理
          const trimmedInput = input.trim();
          
          if (trimmedInput.startsWith('/')) {
            await this.handleCommand(trimmedInput);
          } else if (trimmedInput) {
            await this.handleMessage(trimmedInput);
          }
        }
      }
      
      // 入力統計のリセット（100ms以上経過した場合）
      if (timeSpan > 100) {
        this.inputStats = { lineCount: 0, startTime: 0 };
      }
      
      if (this.running) {
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
        
        
      case '/abort':
        this.abortExecution();
        break;
        
      case '/ps':
      case '/processes':
        this.showBackgroundProcesses();
        break;
        
      case '/stop':
      case '/kill':
        await this.stopBackgroundProcess(args);
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
      // エラーメッセージの可能性をチェック
      const isError = this.isErrorMessage(message);
      
      if (isError && this.lastError === null) {
        // エラーメッセージとして処理
        this.lastError = message;
        await this.handleErrorMessage(message);
      } else if (this.lastError && isError) {
        // 連続したエラーメッセージ
        this.lastError += '\n' + message;
        await this.handleErrorMessage(this.lastError);
      } else {
        // 通常のメッセージ処理
        this.lastError = null;
        
        // タスク実行リクエストの判定
        const isTaskRequest = this.isTaskRequest(message);
        
        if (isTaskRequest) {
          // 自動実行フロー
          await this.handleAutonomousExecution(message);
        } else {
          // 通常のチャット応答
          await this.handleNormalChat(message);
        }
      }
      
    } catch (error: any) {
      console.error(chalk.red('\n❌ エラー:'), error.message);
      // エラーコンテキストを記録
      this.errorTracker.recordContext({
        timestamp: new Date(),
        type: 'execution',
        operation: 'handleMessage',
        details: { message },
        error: error
      });
      console.log();
    } finally {
      this.isProcessing = false;
    }
  }
  
  private isTaskRequest(message: string): boolean {
    const taskKeywords = [
      'create', 'make', 'build', 'implement', 'add', 'setup',
      'install', 'configure', 'generate', 'write', 'develop',
      'fix', 'update', 'modify', 'refactor', 'test', 'deploy',
      '作成', '作って', '実装', '追加', 'セットアップ',
      'インストール', '設定', '生成', '書いて', '開発',
      '修正', '更新', '変更', 'リファクタ', 'テスト', 'デプロイ'
    ];
    
    const lowerMessage = message.toLowerCase();
    return taskKeywords.some(keyword => lowerMessage.includes(keyword));
  }
  
  private async handleAutonomousExecution(request: string): Promise<void> {
    try {
      // プラットフォーム検出
      await platformDetector.detect();
      
      // 段階的自律実行エージェントを使用
      await autonomousAgent.executeRequest(request);
      
    } catch (error) {
      console.error(chalk.red(`\n❌ エラー: ${error}`));
    }
  }
  
  
  
  private async handleNormalChat(message: string): Promise<void> {
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
    console.log(chalk.white('  /approve        - 計画を承認して自動実行'));
    console.log(chalk.white('  /skip           - 現在のタスクをスキップ'));
    console.log(chalk.white('  /rollback       - 直前の変更を取り消し'));
    console.log(chalk.white('  /safe-mode      - セーフモード切替（手動承認）'));
    console.log(chalk.white('  /abort          - 実行を中止'));
    console.log(chalk.white('  /ps, /processes - バックグラウンドプロセス一覧'));
    console.log(chalk.white('  /stop <id>      - バックグラウンドプロセスを停止'));
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
  
  private async exit(): Promise<void> {
    this.running = false;
    
    // セッションを保存
    await this.saveSessionState();
    
    // バックグラウンドプロセスを終了
    this.commandExecutor.killAllBackgroundProcesses();
    
    // 自動保存を停止
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
    }
    
    console.log(chalk.yellow('\n👋 さようなら！'));
    this.rl.close();
    process.exit(0);
  }

  private setupCommandExecutorListeners(): void {
    // Background process events
    this.commandExecutor.on('background:started', (data) => {
      console.log(chalk.blue(`🚀 バックグラウンドプロセスを開始: ${data.command}`));
      console.log(chalk.gray(`  ID: ${data.id}`));
    });
    
    this.commandExecutor.on('background:output', (data) => {
      // サーバー出力を表示（重要な情報のみ）
      if (data.data.includes('Running on') || data.data.includes('Listening') || data.data.includes('Started')) {
        console.log(chalk.green(`  → ${data.data.trim()}`));
      }
    });
    
    this.commandExecutor.on('server:ready', (data) => {
      console.log(chalk.green(`
✅ サーバーが起動しました！`));
      console.log(chalk.cyan(`🌐 http://localhost:${data.port} でアクセス可能です`));
      console.log(chalk.gray(`終了するには /stop ${data.id} または Ctrl+C`));
    });
    
    this.commandExecutor.on('background:error', (data) => {
      if (data.data && data.data.trim()) {
        console.log(chalk.red(`  ⚠ ${data.data.trim()}`));
      }
    });
    
    this.commandExecutor.on('background:completed', (data) => {
      console.log(chalk.yellow(`🏁 バックグラウンドプロセス終了: ${data.id} (コード: ${data.code})`))
    });
  }
  
  private setupEventListeners(): void {
    // Command executor permission events
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
    // 新しいフローでは計画承認は不要
    console.log(chalk.yellow('新しい自律実行モードでは、承認は不要です。'));
    console.log(chalk.cyan('タスクは段階的に自動実行されます。'));
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
  
  private setupInputBufferListeners(): void {
    // バッファから完全なメッセージを受信
    this.inputBuffer.on('message', async (message: string) => {
      const trimmedMessage = message.trim();
      
      if (!trimmedMessage) return;
      
      // コマンドかメッセージかを判定して処理
      if (trimmedMessage.startsWith('/')) {
        await this.handleCommand(trimmedMessage);
      } else {
        await this.handleMessage(trimmedMessage);
      }
      
      if (this.running) {
        this.rl.prompt();
      }
    });
  }
  
  private setupErrorTrackerListeners(): void {
    // エラー修正アクションのリスナー
    this.errorTracker.on('fix:execute', async (data) => {
      console.log(chalk.yellow(`\n🔧 修正コマンドを実行: ${data.command}`));
      // コマンド実行をトリガー
      await this.handleMessage(data.command);
    });
    
    this.errorTracker.on('fix:create_file', async (data) => {
      console.log(chalk.yellow(`\n📝 ファイル作成を提案: ${data.path}`));
      // ファイル作成の提案をAIに送信
      const prompt = `ファイル ${data.path} が見つかりません。このファイルを作成してください。`;
      await this.handleMessage(prompt);
    });
    
    this.errorTracker.on('fix:kill_port', async (data) => {
      console.log(chalk.yellow(`\n🔌 ポート ${data.port} を解放します`));
      // ポート解放コマンドを実行
      const command = process.platform === 'win32' 
        ? `netstat -ano | findstr :${data.port}` 
        : `lsof -ti:${data.port} | xargs kill -9`;
      await this.handleMessage(command);
    });
  }
  
  private isErrorMessage(message: string): boolean {
    const errorPatterns = [
      /error:/i,
      /exception:/i,
      /traceback/i,
      /failed/i,
      /module.*not found/i,
      /cannot find/i,
      /File ".+", line \d+/,
      /SyntaxError/,
      /IndentationError/,
      /ModuleNotFoundError/,
      /FileNotFoundError/,
      /Permission denied/,
      /port.*in use/i,
      /address already in use/i
    ];
    
    return errorPatterns.some(pattern => pattern.test(message));
  }
  
  private async handleErrorMessage(errorMessage: string): Promise<void> {
    console.log(chalk.red('\n🔍 エラーを検出しました:'));
    console.log(chalk.gray(errorMessage.substring(0, 500)));
    
    // エラーコンテキストを記録
    this.errorTracker.recordContext({
      timestamp: new Date(),
      type: 'execution',
      operation: 'error_detected',
      details: { errorMessage },
      error: errorMessage
    });
    
    // 自動修正提案を生成
    const suggestions = await this.errorTracker.analyzeError(errorMessage);
    
    if (suggestions.length > 0) {
      console.log(chalk.cyan('\n💡 自動修正提案:'));
      suggestions.forEach((suggestion, index) => {
        console.log(chalk.white(`${index + 1}. ${suggestion.description} (信頼度: ${suggestion.confidence})`));
      });
      
      // 高信頼度の修正を自動実行
      const highConfidenceFix = suggestions.find(s => s.confidence === 'high');
      if (highConfidenceFix) {
        console.log(chalk.green(`\n✨ 自動修正を実行: ${highConfidenceFix.description}`));
        await highConfidenceFix.action();
      } else {
        // AIに修正を依頼
        const context = this.errorTracker.getRecentContext(3);
        const createdFiles = this.errorTracker.getCreatedFiles();
        
        const fixPrompt = `
以下のエラーが発生しました。修正してください。

エラー:
${errorMessage}

最近の操作:
${context.map(c => `- ${c.operation}`).join('\n')}

作成したファイル:
${createdFiles.join('\n')}
`;
        
        await this.handleNormalChat(fixPrompt);
      }
    } else {
      // AIに修正を依頼
      const fixPrompt = `以下のエラーが発生しました。原因を分析して修正してください:\n\n${errorMessage}`;
      await this.handleNormalChat(fixPrompt);
    }
  }
  
  private showBackgroundProcesses(): void {
    const processes = this.commandExecutor.getBackgroundProcesses();
    
    if (processes.length === 0) {
      console.log(chalk.gray('バックグラウンドプロセスはありません'));
      return;
    }
    
    console.log(chalk.cyan('\n📦 バックグラウンドプロセス:'));
    processes.forEach(proc => {
      const status = proc.status === 'running' 
        ? chalk.green('● 実行中') 
        : proc.status === 'completed' 
        ? chalk.gray('● 完了')
        : chalk.red('● 失敗');
      
      console.log(`  ${proc.id}: ${status} - ${proc.command}`);
      console.log(chalk.gray(`    開始: ${proc.startTime.toLocaleTimeString()}`));
    });
  }
  
  private async stopBackgroundProcess(args: string[]): Promise<void> {
    if (args.length === 0) {
      console.log(chalk.red('プロセスIDを指定してください'));
      return;
    }
    
    const processId = args[0];
    const success = this.commandExecutor.killBackgroundProcess(processId);
    
    if (success) {
      console.log(chalk.green(`✓ プロセス ${processId} を停止しました`));
    } else {
      console.log(chalk.red(`プロセス ${processId} が見つかりません`));
    }
  }
  
  private startAutoSave(): void {
    // 5分ごとに自動保存
    this.autoSaveInterval = setInterval(async () => {
      await this.saveSessionState();
    }, 5 * 60 * 1000);
  }
  
  private async saveSessionState(): Promise<void> {
    try {
      const state = {
        timestamp: new Date().toISOString(),
        profile: this.currentProfile,
        projectContext: this.projectContext,
        sessionId: this.sessionManager.getCurrentSessionId(),
        errorContext: {
          createdFiles: this.errorTracker.getCreatedFiles(),
          executedCommands: this.errorTracker.getExecutedCommands(),
          recentContext: this.errorTracker.getRecentContext(10)
        },
        backgroundProcesses: this.commandExecutor.getBackgroundProcesses().map(p => ({
          id: p.id,
          command: p.command,
          status: p.status,
          startTime: p.startTime
        })),
        safeMode: this.safeMode
      };
      
      await fs.writeJson(this.sessionFilePath, state, { spaces: 2 });
      
      // エラーコンテキストも保存
      const contextPath = path.join(path.dirname(this.sessionFilePath), 'error-context.json');
      await this.errorTracker.saveContext(contextPath);
      
    } catch (error) {
      console.error(chalk.red('セッション保存エラー:'), error);
    }
  }
  
  private async restoreSession(): Promise<void> {
    try {
      if (!await fs.pathExists(this.sessionFilePath)) {
        return;
      }
      
      const state = await fs.readJson(this.sessionFilePath);
      const ageMs = Date.now() - new Date(state.timestamp).getTime();
      
      // 24時間以内のセッションのみ復元
      if (ageMs > 24 * 60 * 60 * 1000) {
        console.log(chalk.gray('古いセッションは無視されました'));
        return;
      }
      
      console.log(chalk.cyan('🔄 前回のセッションを復元します...'));
      
      // プロファイルを復元
      if (state.profile) {
        this.currentProfile = state.profile;
        this.agent = new SimpleChatAgent(this.currentProfile.model);
      }
      
      // プロジェクトコンテキストを復元
      if (state.projectContext) {
        this.projectContext = state.projectContext;
      }
      
      // エラーコンテキストを復元
      const contextPath = path.join(path.dirname(this.sessionFilePath), 'error-context.json');
      await this.errorTracker.loadContext(contextPath);
      
      // セーフモードを復元
      if (state.safeMode !== undefined) {
        this.safeMode = state.safeMode;
      }
      
      // バックグラウンドプロセス情報を表示
      if (state.backgroundProcesses && state.backgroundProcesses.length > 0) {
        console.log(chalk.yellow('\n⚠ 前回のバックグラウンドプロセス:'));
        state.backgroundProcesses.forEach((p: any) => {
          console.log(chalk.gray(`  - ${p.command} (${p.status})`))
        });
      }
      
      console.log(chalk.green('✓ セッションを復元しました'));
      
    } catch (error) {
      console.error(chalk.red('セッション復元エラー:'), error);
    }
  }
}