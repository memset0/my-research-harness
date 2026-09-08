/**
 * `null` only when a path is genuinely absent (`ENOENT`) or is not a directory
 * when a listing was requested (`ENOTDIR`). Every other filesystem failure —
 * permissions, a disconnected or unmounted transport, an I/O error, a timeout —
 * propagates.
 *
 * This exists because the historical `.catch(() => [])` / `.catch(() => null)`
 * shorthand around document discovery turned an unreadable mount into an empty
 * Project: lists rendered as "everything was deleted" instead of "this Project
 * cannot be read right now". Absence is a fact about the Project; unreadability
 * is a fact about the transport, and the two must not collapse.
 */
export async function missingOrThrow<T>(operation: Promise<T>): Promise<T | null> {
  try {
    return await operation
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return null
    throw error
  }
}
