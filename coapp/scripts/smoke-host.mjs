// Starts the native host the way a browser does and asks it who it is.
//
//   node coapp/scripts/smoke-host.mjs PATH_TO_LAUNCHER_OR_JS_ENTRY
//
// Exits 0 if the host answers an `info` request over native messaging
// (4-byte little-endian length, then JSON), 1 otherwise. It proves that what
// the installer put in place actually starts and speaks the protocol.

import { spawn } from 'node:child_process';

const target = process.argv[2];
if (!target) {
  console.error('Usage: node smoke-host.mjs PATH_TO_LAUNCHER_OR_JS_ENTRY');
  process.exit(1);
}

const isScript = /\.(?:c|m)?js$/.test(target);
const child = spawn(isScript ? process.execPath : target, isScript ? [target] : [], {
  stdio: ['pipe', 'pipe', 'inherit']
});

const fail = (message) => {
  console.error(`smoke test failed: ${message}`);
  child.kill();
  process.exit(1);
};
const timer = setTimeout(() => fail('no answer within 10 seconds'), 10_000);

function send(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  const length = Buffer.alloc(4);
  length.writeUInt32LE(body.length, 0);
  child.stdin.write(Buffer.concat([length, body]));
}

let pending = Buffer.alloc(0);
child.stdout.on('data', (chunk) => {
  pending = Buffer.concat([pending, chunk]);
  if (pending.length < 4) return;
  const length = pending.readUInt32LE(0);
  if (pending.length < 4 + length) return;
  const reply = JSON.parse(pending.toString('utf8', 4, 4 + length));
  clearTimeout(timer);
  if (reply._reply !== 1 || reply._error || !reply._result?.version) {
    fail(`unexpected reply: ${JSON.stringify(reply)}`);
  }
  const { version, platform, arch } = reply._result;
  console.log(`host answered: Flux Downloader CoApp ${version} on ${platform}/${arch}`);
  child.kill();
  process.exit(0);
});
child.on('error', (error) => fail(error.message));
child.on('exit', (code) => fail(`host exited early (code ${code})`));

send({ type: 'weh#rpc', _request: 1, _method: 'info', _args: [] });
