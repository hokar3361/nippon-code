import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { Session } from '../agents/chat';
import { getSessionDir } from '../utils/setup';

export class SessionManager {
  private sessionDir: string;

  constructor() {
    this.sessionDir = getSessionDir();
    this.ensureSessionDir();
  }

  private async ensureSessionDir(): Promise<void> {
    await fs.ensureDir(this.sessionDir);
  }

  public async loadOrCreate(name: string): Promise<Session> {
    const sessionPath = this.getSessionPath(name);

    if (await fs.pathExists(sessionPath)) {
      return await this.load(name);
    } else {
      return this.create(name);
    }
  }

  public async load(name: string): Promise<Session> {
    const sessionPath = this.getSessionPath(name);

    if (!await fs.pathExists(sessionPath)) {
      throw new Error(`セッション "${name}" が見つかりません`);
    }

    const data = await fs.readJson(sessionPath);
    
    // 日付をDateオブジェクトに変換
    data.metadata.createdAt = new Date(data.metadata.createdAt);
    data.metadata.updatedAt = new Date(data.metadata.updatedAt);

    return data as Session;
  }

  public create(name: string): Session {
    return {
      id: uuidv4(),
      name,
      messages: [],
      contexts: [],
      metadata: {
        createdAt: new Date(),
        updatedAt: new Date(),
        totalTokens: 0,
      },
    };
  }

  public async save(name: string, session?: Session): Promise<void> {
    const sessionPath = this.getSessionPath(name);
    
    // セッションが提供されていない場合は、現在のセッションを読み込む
    if (!session) {
      if (await fs.pathExists(sessionPath)) {
        session = await this.load(name);
      } else {
        throw new Error(`セッション "${name}" が見つかりません`);
      }
    }

    await fs.writeJson(sessionPath, session, { spaces: 2 });
  }

  public async delete(name: string): Promise<void> {
    const sessionPath = this.getSessionPath(name);
    
    if (await fs.pathExists(sessionPath)) {
      await fs.remove(sessionPath);
    }
  }

  public async list(): Promise<string[]> {
    await this.ensureSessionDir();
    
    const files = await fs.readdir(this.sessionDir);
    return files
      .filter(file => file.endsWith('.json'))
      .map(file => path.basename(file, '.json'));
  }

  public async getLastSession(): Promise<string | null> {
    const sessions = await this.list();
    
    if (sessions.length === 0) {
      return null;
    }

    // 最終更新日時でソート
    const sessionInfos = await Promise.all(
      sessions.map(async name => {
        const session = await this.load(name);
        return {
          name,
          updatedAt: session.metadata.updatedAt,
        };
      })
    );

    sessionInfos.sort((a, b) => 
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );

    return sessionInfos[0].name;
  }

  public async export(name: string, outputPath: string): Promise<void> {
    const session = await this.load(name);
    
    // マークダウン形式でエクスポート
    const markdown = this.sessionToMarkdown(session);
    await fs.writeFile(outputPath, markdown, 'utf-8');
  }

  private sessionToMarkdown(session: Session): string {
    const lines: string[] = [];
    
    lines.push(`# VLLMCode Session: ${session.name}`);
    lines.push('');
    lines.push(`**Created:** ${session.metadata.createdAt}`);
    lines.push(`**Updated:** ${session.metadata.updatedAt}`);
    lines.push(`**Total Tokens:** ${session.metadata.totalTokens || 0}`);
    lines.push('');
    
    if (session.contexts.length > 0) {
      lines.push('## Context');
      lines.push('');
      
      for (const context of session.contexts) {
        lines.push(`### ${context.type}: ${context.path || context.name || 'N/A'}`);
        lines.push('');
        lines.push('```');
        lines.push(context.content);
        lines.push('```');
        lines.push('');
      }
    }
    
    if (session.messages.length > 0) {
      lines.push('## Conversation');
      lines.push('');
      
      for (const message of session.messages) {
        if (message.role === 'user') {
          lines.push('### User');
        } else if (message.role === 'assistant') {
          lines.push('### Assistant');
        } else {
          lines.push(`### ${message.role}`);
        }
        lines.push('');
        lines.push(message.content);
        lines.push('');
      }
    }
    
    return lines.join('\n');
  }

  private getSessionPath(name: string): string {
    return path.join(this.sessionDir, `${name}.json`);
  }

  public async cleanup(daysOld: number = 30): Promise<number> {
    await this.ensureSessionDir();
    
    const now = new Date();
    const cutoffTime = now.getTime() - (daysOld * 24 * 60 * 60 * 1000);
    
    const sessions = await this.list();
    let deletedCount = 0;
    
    for (const name of sessions) {
      try {
        const session = await this.load(name);
        const updatedTime = new Date(session.metadata.updatedAt).getTime();
        
        if (updatedTime < cutoffTime) {
          await this.delete(name);
          deletedCount++;
        }
      } catch (error) {
        // エラーが発生した場合はスキップ
        console.warn(`セッション "${name}" の処理中にエラーが発生しました:`, error);
      }
    }
    
    return deletedCount;
  }
}

