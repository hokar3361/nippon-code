import { OpenAIProvider } from '../providers/openai';
import { config } from '../config';

export interface CodeGenerationRequest {
  task: string;
  language?: string;
  framework?: string;
  requirements?: string[];
  context?: string;
}

export interface GeneratedCode {
  fileName: string;
  content: string;
  language: string;
  description?: string;
}

export class CodeGenerator {
  private aiProvider: OpenAIProvider;

  constructor() {
    this.aiProvider = new OpenAIProvider(
      config.get('apiKey'),
      config.get('apiBaseUrl'),
      config.get('model')
    );
  }

  async generateCode(request: CodeGenerationRequest): Promise<GeneratedCode[]> {
    const prompt = this.buildPrompt(request);
    
    try {
      const response = await this.aiProvider.complete({
        messages: [{ role: 'user', content: prompt }],
        model: config.get('model'),
        temperature: 0.7,
        maxTokens: 4096
      });
      
      if (!response.content) {
        throw new Error('No response from AI');
      }
      return this.parseCodeResponse(response.content);
    } catch (error) {
      console.error('Code generation failed:', error);
      throw new Error(`Failed to generate code: ${error}`);
    }
  }

  private buildPrompt(request: CodeGenerationRequest): string {
    return `You are an expert programmer. Generate production-ready code for the following task:

Task: ${request.task}
${request.language ? `Language: ${request.language}` : ''}
${request.framework ? `Framework: ${request.framework}` : ''}
${request.requirements ? `Requirements:\n${request.requirements.map(r => `- ${r}`).join('\n')}` : ''}
${request.context ? `Context:\n${request.context}` : ''}

Please generate the complete code with the following format:
1. Each file should start with "### FILE: filename.ext"
2. Include all necessary imports and dependencies
3. Add appropriate comments
4. Make the code production-ready and fully functional

Generate the code now:`;
  }

  private parseCodeResponse(response: string): GeneratedCode[] {
    const files: GeneratedCode[] = [];
    const filePattern = /### FILE:\s*(.+?)[\r\n]+```(\w+)?\s*\n([\s\S]*?)```/g;
    
    let match;
    while ((match = filePattern.exec(response)) !== null) {
      const fileName = match[1].trim();
      const language = match[2] || this.detectLanguage(fileName);
      const content = match[3].trim();
      
      files.push({
        fileName,
        content,
        language,
        description: `Generated ${fileName}`
      });
    }

    // フォールバック: ファイル形式が見つからない場合
    if (files.length === 0 && response.includes('```')) {
      const codeBlockPattern = /```(\w+)?\s*\n([\s\S]*?)```/g;
      let blockMatch;
      let index = 0;
      
      while ((blockMatch = codeBlockPattern.exec(response)) !== null) {
        const language = blockMatch[1] || 'javascript';
        const content = blockMatch[2].trim();
        const ext = this.getExtension(language);
        
        files.push({
          fileName: `generated_${index}.${ext}`,
          content,
          language,
          description: 'Auto-generated file'
        });
        index++;
      }
    }

    return files;
  }

  private detectLanguage(fileName: string): string {
    const ext = fileName.split('.').pop()?.toLowerCase();
    const langMap: Record<string, string> = {
      'js': 'javascript',
      'jsx': 'javascript',
      'ts': 'typescript',
      'tsx': 'typescript',
      'py': 'python',
      'rb': 'ruby',
      'java': 'java',
      'cpp': 'cpp',
      'c': 'c',
      'cs': 'csharp',
      'go': 'go',
      'rs': 'rust',
      'php': 'php',
      'swift': 'swift',
      'kt': 'kotlin',
      'scala': 'scala',
      'sh': 'bash',
      'sql': 'sql',
      'html': 'html',
      'css': 'css',
      'json': 'json',
      'xml': 'xml',
      'yaml': 'yaml',
      'yml': 'yaml',
      'md': 'markdown'
    };
    
    return langMap[ext || ''] || 'text';
  }

  private getExtension(language: string): string {
    const extMap: Record<string, string> = {
      'javascript': 'js',
      'typescript': 'ts',
      'python': 'py',
      'ruby': 'rb',
      'java': 'java',
      'cpp': 'cpp',
      'c': 'c',
      'csharp': 'cs',
      'go': 'go',
      'rust': 'rs',
      'php': 'php',
      'swift': 'swift',
      'kotlin': 'kt',
      'scala': 'scala',
      'bash': 'sh',
      'sql': 'sql',
      'html': 'html',
      'css': 'css',
      'json': 'json',
      'xml': 'xml',
      'yaml': 'yaml',
      'markdown': 'md'
    };
    
    return extMap[language.toLowerCase()] || 'txt';
  }

  async generateExpressServer(): Promise<GeneratedCode[]> {
    return this.generateCode({
      task: 'Create a complete Express.js server with basic routes',
      language: 'javascript',
      framework: 'express',
      requirements: [
        'Basic Express server setup',
        'GET / route that returns "Hello World"',
        'GET /api/users route that returns a sample user list',
        'POST /api/users route to add a user',
        'Error handling middleware',
        'Port configuration from environment variable or default 3000',
        'package.json with all dependencies'
      ]
    });
  }

  async generateFromDescription(description: string): Promise<GeneratedCode[]> {
    // タスクの種類を判定
    const lowerDesc = description.toLowerCase();
    
    if (lowerDesc.includes('express') || lowerDesc.includes('server')) {
      return this.generateExpressServer();
    } else if (lowerDesc.includes('react')) {
      return this.generateCode({
        task: description,
        language: 'javascript',
        framework: 'react'
      });
    } else if (lowerDesc.includes('python')) {
      return this.generateCode({
        task: description,
        language: 'python'
      });
    } else {
      // デフォルトはJavaScript
      return this.generateCode({
        task: description,
        language: 'javascript'
      });
    }
  }
}

export const codeGenerator = new CodeGenerator();