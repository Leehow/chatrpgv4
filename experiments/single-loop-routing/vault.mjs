/**
 * The App keeps extension secrets in an encrypted vault under the agent profile
 * (Electron/packages/pi-backend/src/secret-vault.ts: AES-256-GCM envelope, 32-byte key file). The
 * prototype reads ONE secret from it into the child environment the same way the App's spawn does
 * (`EXT_JEV_APIKEY`), and never prints, logs or copies it anywhere else. Read-only.
 */
import {createDecipheriv} from 'node:crypto';
import {existsSync, readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';

export const AGENT_DIR = join(homedir(), 'Library/Application Support/Pipi/pipicoc/pi-coc/agent');

export function readVaultSecret(envName, dir = AGENT_DIR) {
  const file = join(dir, 'secret-vault.json'), keyFile = join(dir, 'secret-vault.key');
  if (!existsSync(file) || !existsSync(keyFile)) return undefined;
  const envelope = JSON.parse(readFileSync(file, 'utf8')), key = readFileSync(keyFile);
  if (envelope.version !== 2 || envelope.algorithm !== 'aes-256-gcm' || key.length !== 32) throw new Error('secret vault envelope is not the shape this reader knows');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const document = JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
  const secret = document.secrets.find(entry => entry.envName === envName);
  return typeof secret?.value === 'string' && secret.value.trim() ? secret.value.trim() : undefined;
}
