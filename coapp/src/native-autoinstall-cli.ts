import { registerManifest, unregisterManifest } from './native-autoinstall';

const args = process.argv.slice(2);

if (args[0] === 'register') {
  registerManifest(args.slice(1))
    .then(() => {
      console.error('[Flux] Registration complete');
    })
    .catch(error => {
      console.error('[Flux] Registration failed:', error);
      process.exitCode = 1;
    });
} else if (args[0] === 'unregister') {
  unregisterManifest()
    .then(() => {
      console.error('[Flux] Unregistration complete');
    })
    .catch(error => {
      console.error('[Flux] Unregistration failed:', error);
      process.exitCode = 1;
    });
} else {
  console.log('Usage: node dist/native-autoinstall-cli.js register [extension-id...] | unregister');
  process.exitCode = 1;
}
