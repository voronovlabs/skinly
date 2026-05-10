import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, verifySession } from "@/lib/auth/session";

/**
 * Edge middleware для маршрутов, требующих сессию (user или guest).
 *
 * Edge runtime: импортируем только `lib/auth/session` (jose), без
 * `next/headers` или Node-only API.
 *
 * Phase 11 — правила доступа:
 *   - PROTECTED_PREFIXES: нужна любая сессия (user ИЛИ guest).
 *     Без сессии → /welcome.
 *   - AUTH_PAGES (/login, /register): прячем ТОЛЬКО от user'а
 *     (он уже залогинен → ему незачем). Guest должен пройти спокойно,
 *     потому что онбординг → account gate ведёт guest'а ровно сюда:
 *       guest → /onboarding/complete → /register (или /login)
 *     Если бы middleware гнал guest'а с /register на /dashboard,
 *     gate flow был бы сломан и пользователь никогда бы не создал
 *     настоящий аккаунт.
 *   - /welcome: тоже прячем от user'а, redirect → /dashboard.
 *     Guest на /welcome — нормальный сценарий (он мог нажать "Назад").
 */

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/history",
  "/favorites",
  "/profile",
  "/scan",
  "/product",
  "/onboarding",
];

/**
 * Страницы, которые залогиненному user'у показывать НЕ нужно — у него уже
 * есть аккаунт. Guest же должен иметь возможность открыть /login и /register
 * (это путь account-gate'а: онбординг → /onboarding/complete → /register).
 */
const USER_ONLY_REDIRECT_PAGES = ["/welcome", "/login", "/register"];

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

function isUserOnlyRedirectPage(pathname: string): boolean {
  return USER_ONLY_REDIRECT_PAGES.includes(pathname);
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const protectedRoute = isProtected(pathname);
  const userOnlyRedirect = isUserOnlyRedirectPage(pathname);

  if (!protectedRoute && !userOnlyRedirect) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySession(token) : null;

  // Анонимов на приватные экраны не пускаем.
  if (protectedRoute && !session) {
    const url = req.nextUrl.clone();
    url.pathname = "/welcome";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // User не должен видеть welcome/login/register — он уже залогинен.
  // Guest проходит насквозь (account gate flow).
  if (userOnlyRedirect && session?.type === "user") {
    const url = req.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon\\.ico).*)"],
};
