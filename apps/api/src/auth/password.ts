import { hashSync, compareSync } from 'bcryptjs'

export function hashPassword(plain: string): string {
  return hashSync(plain, 10)
}

export function verifyPassword(plain: string, hash: string): boolean {
  return compareSync(plain, hash)
}
