// Native Messaging Host Auto-Install
// Handles registration/unregistration of native messaging host

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { getHostBinaryPath, getInstallDir, installedNativeMessagingTargets, nativeMessagingTargets } from './paths';

const MANIFEST_NAME = 'com.fluxdownloader.coapp.json';

export interface ManifestContent {
  name: string;
  description: string;
  path: string;
  type: string;
  allowed_origins: string[];
}
function getManifestPath(): string {
  return path.join(getInstallDir(), MANIFEST_NAME);
}
function getChromeRegistryKeyPath(): string {
  if (process.platform === 'win32') {
    return 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.fluxdownloader.coapp';
  }
  return '';
}

function getEdgeRegistryKeyPath(): string {
  if (process.platform === 'win32') {
    return 'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.fluxdownloader.coapp';
  }
  return '';
}

function getManifestContent(extensionIds?: string[]): ManifestContent {
  const defaultOrigins = [
    'chrome-extension://{CHROME_EXTENSION_ID}/',
    'chrome-extension://{EDGE_EXTENSION_ID}/'
  ];
  
  return {
    name: 'com.fluxdownloader.coapp',
    description: 'Flux Downloader companion application',
    path: getHostBinaryPath(),
    type: 'stdio',
    allowed_origins: extensionIds?.length ? extensionIds.map(id => `chrome-extension://${id}/`) : defaultOrigins
  };
}

/**
 * Register the native messaging manifest
 */
export async function registerManifest(extensionIds?: string[]): Promise<void> {
  const manifest = getManifestContent(extensionIds);
  const manifestPath = getManifestPath();
  
  // Ensure install directory exists
  await fs.promises.mkdir(getInstallDir(), { recursive: true });
  
  // Write manifest file
  await fs.promises.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  
  console.error(`[Flux] Manifest written to: ${manifestPath}`);
  
  // Register based on platform
  if (process.platform === 'win32') {
    await registerWindows(manifestPath);
  } else {
    await registerUnix(manifestPath);
  }
}

/**
 * Unregister the native messaging manifest
 */
export async function unregisterManifest(): Promise<void> {
  if (process.platform === 'win32') {
    await unregisterWindows();
  } else {
    await unregisterUnix();
  }
  
  // Remove manifest file
  const manifestPath = getManifestPath();
  try {
    await fs.promises.unlink(manifestPath);
    console.error(`[Flux] Manifest removed: ${manifestPath}`);
  } catch {
    // File may not exist
  }
}

// Windows registration
async function registerWindows(manifestPath: string): Promise<void> {
  // Register for Chrome
  const chromeKeyPath = getChromeRegistryKeyPath();
  try {
    execSync(`reg add "${chromeKeyPath}" /ve /d "${manifestPath}" /f`, { stdio: 'pipe' });
    console.error(`[Flux] Registry key added: ${chromeKeyPath}`);
  } catch (e) {
    console.error('[Flux] Failed to add Chrome registry key:', e);
    throw e;
  }
  
  // Register for Edge
  const edgeKeyPath = getEdgeRegistryKeyPath();
  try {
    execSync(`reg add "${edgeKeyPath}" /ve /d "${manifestPath}" /f`, { stdio: 'pipe' });
    console.error(`[Flux] Registry key added: ${edgeKeyPath}`);
  } catch (e) {
    console.error('[Flux] Failed to add Edge registry key:', e);
    // Don't throw - Edge registration is not critical
  }
}

async function unregisterWindows(): Promise<void> {
  // Unregister Chrome
  const chromeKeyPath = getChromeRegistryKeyPath();
  try {
    execSync(`reg delete "${chromeKeyPath}" /f`, { stdio: 'pipe' });
    console.error(`[Flux] Registry key removed: ${chromeKeyPath}`);
  } catch {
    // Key may not exist
  }
  
  // Unregister Edge
  const edgeKeyPath = getEdgeRegistryKeyPath();
  try {
    execSync(`reg delete "${edgeKeyPath}" /f`, { stdio: 'pipe' });
    console.error(`[Flux] Registry key removed: ${edgeKeyPath}`);
  } catch {
    // Key may not exist
  }
}

// macOS and Linux registration: one manifest file per installed browser.
async function registerUnix(manifestPath: string): Promise<void> {
  for (const { browser, dir } of installedNativeMessagingTargets()) {
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.copyFile(manifestPath, path.join(dir, MANIFEST_NAME));
    console.error(`[Flux] Manifest copied for ${browser}: ${dir}`);
  }
}

async function unregisterUnix(): Promise<void> {
  // Every known browser, not just the installed ones: a browser may have been
  // removed since Flux registered with it.
  for (const { browser, dir } of nativeMessagingTargets()) {
    try {
      await fs.promises.unlink(path.join(dir, MANIFEST_NAME));
      console.error(`[Flux] Manifest removed for ${browser}: ${dir}`);
    } catch {
      // File may not exist
    }
  }
}
