import { redirect } from "next/navigation";

/**
 * Корневой маршрут перенаправляет на /welcome.
 * После Phase 4 (auth) здесь появится логика:
 *   - есть session (user/guest) и заполнен профиль → /dashboard
 *   - есть session без профиля                    → /onboarding
 *   - иначе                                        → /welcome
 */
export default function RootPage() {
  redirect("/welcome");
}
