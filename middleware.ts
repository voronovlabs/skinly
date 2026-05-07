import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, verifySession } from "@/lib/auth/session";

/**
 * Edge middleware для маршрутов, требующих сессию (user или guest).
 *
 * Edge runtime: импортируем только `lib/auth/session` (jose), без
 * `next/headers` или Node-only API.
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

const AUTH_PAGES = ["/login", "/register"];

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

function isAuthPage(pathname: string): boolean {
  return AUTH_PAGES.includes(pathname);
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const protectedRoute = isProtected(pathname);
  const authRoute = isAuthPage(pathname);

  if (!protectedRoute && !authRoute) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySession(token) : null;

  if (protectedRoute && !session) {
    const url = req.nextUrl.clone();
    url.pathname = "/welcome";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (authRoute && session) {
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
