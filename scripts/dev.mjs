import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const editorPort = process.env.PORT || '4173';
const apiPort = process.env.DRAFTLY_API_PORT || '4174';
const children = [
  spawn(npm, ['run', 'dev', '--workspace', '@draftly/server'], {
    env: { ...process.env, PORT: apiPort },
    stdio: 'inherit',
  }),
  spawn(npm, [
    'run',
    'dev',
    '--workspace',
    '@draftly/editor',
    '--',
    '--host',
    '0.0.0.0',
    '--port',
    editorPort,
    '--strictPort',
  ], {
    env: {
      ...process.env,
      DRAFTLY_API_ORIGIN: `http://127.0.0.1:${apiPort}`,
    },
    stdio: 'inherit',
  }),
];

let stopping = false;

function stop(signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null) child.kill(signal);
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => stop(signal));
}

for (const child of children) {
  child.on('error', (error) => {
    console.error(error);
    stop();
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    if (!stopping) {
      console.error(`Development process exited (${signal || code || 0}).`);
      process.exitCode = code || 1;
      stop();
    }
  });
}

await Promise.all(children.map((child) => new Promise((resolve) => child.once('exit', resolve))));
