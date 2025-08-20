import chalk from 'chalk';
import { readFileSync } from 'fs';
import { join } from 'path';

export function displayBanner(): void {
  const version = getVersion();
  
  const banner = `
${chalk.cyan('╔════════════════════════════════════════════════════════════════╗')}
${chalk.cyan('║')}                                                                ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.bold.white('███╗   ██╗██╗██████╗ ██████╗  ██████╗ ███╗   ██╗')}            ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.bold.white('████╗  ██║██║██╔══██╗██╔══██╗██╔═══██╗████╗  ██║')}            ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.bold.red('██╔██╗ ██║██║██████╔╝██████╔╝██║   ██║██╔██╗ ██║')}            ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.bold.red('██║╚██╗██║██║██╔═══╝ ██╔═══╝ ██║   ██║██║╚██╗██║')}            ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.bold.white('██║ ╚████║██║██║     ██║     ╚██████╔╝██║ ╚████║')}            ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.bold.white('╚═╝  ╚═══╝╚═╝╚═╝     ╚═╝      ╚═════╝ ╚═╝  ╚═══╝')}            ${chalk.cyan('║')}
${chalk.cyan('║')}                                                                ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.bold.yellow('  ██████╗ ██████╗ ██████╗ ███████╗')}                          ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.bold.yellow(' ██╔════╝██╔═══██╗██╔══██╗██╔════╝')}                          ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.bold.yellow(' ██║     ██║   ██║██║  ██║█████╗')}                            ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.bold.yellow(' ██║     ██║   ██║██║  ██║██╔══╝')}                            ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.bold.yellow(' ╚██████╗╚██████╔╝██████╔╝███████╗')}                          ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.bold.yellow('  ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝')}                          ${chalk.cyan('║')}
${chalk.cyan('║')}                                                                ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.gray('🇯🇵 日本語に強いAIコーディングアシスタント')}                    ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.gray(`Version ${version} | Type /help for commands`)}                     ${chalk.cyan('║')}
${chalk.cyan('║')}                                                                ${chalk.cyan('║')}
${chalk.cyan('╚════════════════════════════════════════════════════════════════╝')}
`;

  console.log(banner);
}

export function displayCompactBanner(): void {
  const version = getVersion();
  console.log(chalk.cyan.bold('\n⚡ NipponCode') + chalk.gray(` v${version} - 日本語AIコーディングアシスタント\n`));
}

function getVersion(): string {
  try {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
    return packageJson.version || '0.1.0';
  } catch {
    return '0.1.0';
  }
}