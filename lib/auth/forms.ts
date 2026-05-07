/**
 * Формы аутентификации — типы и initial state.
 *
 * Этот файл специально вынесен из `app/actions/auth.ts`: файлы с директивой
 * "use server" в Next.js могут экспортировать ТОЛЬКО async-функции.
 * Любой `export const` (object) или `export type/interface` ломает сборку
 * с ошибкой:
 *   A "use server" file can only export async functions, found object.
 *
 * Поэтому типы и константы для useActionState живут здесь, а server actions
 * (registerAction / loginAction / ...) — в `app/actions/auth.ts`.
 */

export type AuthErrorCode =
  | "validation"
  | "invalid_credentials"
  | "email_taken"
  | "db_unavailable"
  | "unknown";

export interface AuthFormState {
  error?: AuthErrorCode;
  /** Email, который пользователь успел ввести (чтобы не терялся при ошибке). */
  email?: string;
  name?: string;
}

export const INITIAL_AUTH_STATE: AuthFormState = {};
