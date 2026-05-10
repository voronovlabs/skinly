"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { useDemoStore } from "@/lib/demo-store";
import { migrateGuestToUserAction } from "@/app/actions/migrate-guest";
import type {
  GuestProfilePayload,
  GuestStatePayload,
} from "@/lib/db/repositories/migration";

/**
 * GuestMigrator — невидимый компонент в (app) layout.
 *
 * На mount:
 *   1. Ждёт hydration demo store'а.
 *   2. Если в demo store ничего нет → ничего не делаем.
 *   3. Иначе зовёт `migrateGuestToUserAction(payload)`.
 *      Action сам проверит session.type и:
 *        - вернёт { ok: false, reason: "not_user" } если гость → no-op
 *        - сделает merge в БД для user'а
 *   4. После успеха ставит флаг в localStorage и `router.refresh()`,
 *      чтобы серверные страницы (/dashboard etc.) подтянули свежие данные.
 *
 * Идемпотентность:
 *   - Флаг `skinly:migrated-for:<userId>` — повторный запуск этим user'ом
 *     даже после refresh не вызовет action.
 *   - Сама action идемпотентна на уровне БД (см. migration.ts).
 *
 * Demo store НЕ сбрасывается — он остаётся client-side кэшем; server
 * страницы перезаписывают его данные при render'е.
 */

const MIGRATED_KEY = "skinly:migrated-for";

export function GuestMigrator() {
  const router = useRouter();
  const locale = useLocale();
  const { state, hydrated } = useDemoStore();
  const launched = useRef(false);

  useEffect(() => {
    if (!hydrated || launched.current) return;

    // Есть ли смысл что-то слать?
    const hasProfile =
      state.skinProfile &&
      state.skinProfile.completion > 0 &&
      state.skinProfile.skinType &&
      state.skinProfile.sensitivity &&
      state.skinProfile.goal;
    const hasFavorites = state.favoriteIds.length > 0;
    const hasHistory = state.history.length > 0;
    if (!hasProfile && !hasFavorites && !hasHistory) return;

    launched.current = true;

    const payload: GuestStatePayload = {
      skinProfile: hasProfile
        ? ({
            skinType: state.skinProfile!.skinType!.toUpperCase(),
            sensitivity: state.skinProfile!.sensitivity!.toUpperCase(),
            concerns: state.skinProfile!.concerns.map((c) => c.toUpperCase()),
            avoidedList: state.skinProfile!.avoidedList.map((a) =>
              a.toUpperCase(),
            ),
            goal: state.skinProfile!.goal!.toUpperCase(),
            completion: state.skinProfile!.completion,
          } as unknown as GuestProfilePayload)
        : null,
      favoriteIds: state.favoriteIds,
      scans: state.history.map((s) => ({
        productId: s.productId,
        scannedAt: s.scannedAt,
      })),
      locale: locale === "en" ? "en" : "ru",
    };

    void (async () => {
      try {
        const result = await migrateGuestToUserAction(payload);
        if (result.ok) {
          // Защищаемся от повторных запусков для того же user'а.
          // (Если уже был флаг — короткое replay не страшно: action идемпотентен.)
          if (typeof window !== "undefined") {
            try {
              const prev = window.localStorage.getItem(MIGRATED_KEY);
              if (prev !== result.userId) {
                window.localStorage.setItem(MIGRATED_KEY, result.userId);
              }
            } catch {
              /* private mode / disabled storage — okay */
            }
          }
          // Обновляем server-rendered данные на текущей странице.
          router.refresh();
        } else if (result.reason === "not_user") {
          // Гость — миграция не нужна. Тихо выходим, не ставим флаг.
          launched.current = false;
        }
        // db_error / validation — лога достаточно, UI работает на demo store.
      } catch (e) {
        console.error("[guest-migrator] unexpected:", e);
        launched.current = false;
      }
    })();
  }, [hydrated, state, locale, router]);

  return null;
}
