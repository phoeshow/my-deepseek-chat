import { getDb } from '../index'

export function countSessions(): number {
  const row = getDb().prepare('SELECT COUNT(*) AS count FROM sessions').get() as
    | { count: number }
    | undefined
  return row?.count ?? 0
}
