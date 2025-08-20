import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { getSessionDir } from '../utils/setup';

export interface SimpleSession {
  id: string;
  createdAt: string;
  updatedAt: string;
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;
}

export class SimpleSessionManager {
  private sessionDir: string;
  private currentSession: SimpleSession | null = null;

  constructor() {
    this.sessionDir = getSessionDir();
    fs.ensureDirSync(this.sessionDir);
  }

  public async createSession(): Promise<SimpleSession> {
    const session: SimpleSession = {
      id: uuidv4(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
    };
    
    this.currentSession = session;
    await this.saveSession();
    return session;
  }

  public async loadSession(sessionId: string): Promise<SimpleSession | null> {
    const sessionPath = path.join(this.sessionDir, `${sessionId}.json`);
    
    if (await fs.pathExists(sessionPath)) {
      const session = await fs.readJson(sessionPath);
      this.currentSession = session;
      return session;
    }
    
    return null;
  }

  public async listSessions(): Promise<SimpleSession[]> {
    const files = await fs.readdir(this.sessionDir);
    const sessions: SimpleSession[] = [];
    
    for (const file of files) {
      if (file.endsWith('.json')) {
        try {
          const session = await fs.readJson(path.join(this.sessionDir, file));
          sessions.push(session);
        } catch (error) {
          // 無効なセッションファイルは無視
        }
      }
    }
    
    return sessions.sort((a, b) => 
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  public async addMessage(message: { role: 'user' | 'assistant' | 'system'; content: string }): Promise<void> {
    if (!this.currentSession) {
      await this.createSession();
    }
    
    this.currentSession!.messages.push(message);
    this.currentSession!.updatedAt = new Date().toISOString();
  }

  public async saveSession(): Promise<void> {
    if (!this.currentSession) {
      return;
    }
    
    const sessionPath = path.join(this.sessionDir, `${this.currentSession.id}.json`);
    await fs.writeJson(sessionPath, this.currentSession, { spaces: 2 });
  }

  public getCurrentSessionId(): string | null {
    return this.currentSession?.id || null;
  }

  public async getLastSession(): Promise<string | null> {
    const sessions = await this.listSessions();
    return sessions.length > 0 ? sessions[0].id : null;
  }

  public async loadOrCreate(sessionName: string): Promise<SimpleSession> {
    const session = await this.loadSession(sessionName);
    if (session) {
      return session;
    }
    return await this.createSession();
  }

  public async save(_sessionName: string): Promise<void> {
    await this.saveSession();
  }
}