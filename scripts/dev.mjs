// `npm run dev`: starts the game server and the Vite dev server together.
// Stop both with Ctrl+C.
import { spawn } from 'node:child_process';

const run = (name, args) => {
  const child = spawn('npm', ['run', name, ...args], { stdio: 'inherit', shell: process.platform === 'win32' });
  child.on('exit', (code) => {
    console.log(`\n${name} stopped (code ${code}). Stopping everything.`);
    process.exit(code ?? 0);
  });
  return child;
};

const children = [run('dev:server', []), run('dev:client', ['--', '--clearScreen', 'false'])];
process.on('SIGINT', () => {
  for (const c of children) c.kill('SIGINT');
  process.exit(0);
});
