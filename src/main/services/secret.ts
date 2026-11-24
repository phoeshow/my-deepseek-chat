import { chmodSync, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { safeStorage } from 'electron'
import type { EncryptionStatus } from '@shared/types'
import { logger } from '../logger'

/**
 * API Key 存储（docs/03 §1、docs/02 §8）。
 *
 * Electron 45 起 safeStorage 的同步 API 已废弃，必须用异步版本
 * （isAsyncEncryptionAvailable / encryptStringAsync / decryptStringAsync）。
 *
 * 两个容易漏掉的行为：
 * 1. decryptStringAsync 会返回 shouldReEncrypt —— 系统主密钥轮换过，需要立刻用新密钥重写，
 *    否则下次读取可能失败。
 * 2. Linux 的 basic_text 后端用固定口令加密，等同于明文。它会让"可用"返回 true，
 *    所以这里额外标记 weak，由 UI 显示为弱加密而不是安全。
 */
interface SecretFile {
  enc?: string
  plain?: string
}

let filePath = ''

export function initSecret(dataDir: string): void {
  filePath = join(dataDir, 'secret.json')
}

function backend(): string | null {
  try {
    // 该 API 只在 Linux 有意义，其他平台调用返回 unknown
    return process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : null
  } catch {
    return null
  }
}

export async function encryptionStatus(): Promise<EncryptionStatus> {
  let available = false
  try {
    available = await safeStorage.isAsyncEncryptionAvailable()
  } catch (err) {
    logger.warn('[secret] isAsyncEncryptionAvailable failed', err)
  }
  const current = backend()
  return {
    available,
    backend: current,
    weak: available && current === 'basic_text'
  }
}

/** 只判断文件是否存在密钥；不解密，保证 bootstrap 不碰密钥材料 */
export function hasKey(): boolean {
  const data = readSecret()
  return Boolean(data?.enc ?? data?.plain)
}

export async function setKey(apiKey: string): Promise<void> {
  const trimmed = apiKey.trim()
  if (!trimmed) throw new Error('API Key 不能为空')

  const status = await encryptionStatus()
  if (!status.available) {
    writeSecret({ plain: trimmed })
    logger.warn('[secret] safeStorage unavailable — key stored as plaintext (chmod 600)')
    return
  }

  const encrypted = await safeStorage.encryptStringAsync(trimmed)
  writeSecret({ enc: encrypted.toString('base64') })
}

export async function getKey(): Promise<string | null> {
  const data = readSecret()
  if (!data) return null
  if (data.plain) return data.plain
  if (!data.enc) return null

  try {
    const decrypted = await safeStorage.decryptStringAsync(Buffer.from(data.enc, 'base64'))
    if (decrypted.shouldReEncrypt) {
      // 系统主密钥已轮换：用新密钥重写，否则后续读取可能失败
      const reEncrypted = await safeStorage.encryptStringAsync(decrypted.result)
      writeSecret({ enc: reEncrypted.toString('base64') })
      logger.info('[secret] re-encrypted key after master key rotation')
    }
    return decrypted.result
  } catch (err) {
    logger.error('[secret] failed to decrypt key', err)
    return null
  }
}

export function clearKey(): void {
  if (filePath && existsSync(filePath)) unlinkSync(filePath)
}

function writeSecret(payload: SecretFile): void {
  const tmp = `${filePath}.tmp`
  writeFileSync(tmp, `${JSON.stringify(payload)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(tmp, filePath)
  // 落盘后再收一次权限：tmp 的 mode 在部分文件系统上会被 umask 放宽
  chmodSync(filePath, 0o600)
}

function readSecret(): SecretFile | null {
  if (!filePath || !existsSync(filePath)) return null
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as SecretFile
  } catch (err) {
    logger.error('[secret] failed to parse secret.json', err)
    return null
  }
}
