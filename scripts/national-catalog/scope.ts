/**
 * Phase 13.5 · final scope guard.
 *
 * Поверх island-discovery (Phase 13.4) ставим финальный фильтр на detail-этапе:
 *   - если scraper запущен с `--start-path` (т.е. island mode), товар обязан
 *     лежать под "Косметика и парфюмерия" в breadcrumb'ах;
 *   - дополнительно: если `startPath` в нашем известном маппинге slug→title,
 *     один из breadcrumb'ов должен совпадать с этим title.
 *
 * Если scope не проходит — caller'у возвращается `{ ok: false, reason }`,
 * товар **не пишется** ни в JSONL, ни в Postgres. Это последний барьер
 * против leak'а в чужие категории (пиротехника, пожарка, ...), даже если
 * discovery каким-то невероятным образом подсунул такой URL.
 *
 * Минимально-инвазивно:
 *   - чистый pure-helper, без I/O
 *   - не меняет существующие types / contracts
 *   - не зависит от parser/discovery
 */

import { ROOT_CATEGORY_PATH } from "./config";
import type { ScrapedProduct } from "./types";

/**
 * Известные breadcrumb-заголовки, под которыми лежат конкретные startPath'ы
 * на национальном каталоге. Если новый startPath не в этом map'е — guard
 * фолбэчит к проверке только root cosmetic title'а.
 *
 * Сравнение делается через normalize() ниже: case-insensitive, ё/е equate,
 * пробелы схлопнуты, nbsp заменён. `breadcrumb.includes(expected)` —
 * нам достаточно, чтобы expected был подстрокой реального хлебной крошки
 * (с национального каталога они стабильны и совпадают почти посимвольно).
 */
const STARTPATH_TO_BREADCRUMB: Record<string, string> = {
  "/parfyumeriya/": "Парфюмерия",
  "/kosmetika/": "Косметика",
  "/sredstva-kosmeticheskie-antisepticheskie/":
    "Средства косметические антисептические",
  "/dezodoranty-antiperspiranty/": "Дезодоранты и антиперспиранты",
  "/sredstva-i-aksessuary-dlya-manikyura-i-pedikyura-dusha-bani-i-sauny/":
    "Средства и аксессуары для маникюра и педикюра",
  "/kosmetika-dlya-volos/": "Косметика для волос",
  "/mylo-i-sredstva-dlya-mytya/": "Мыло и средства для мытья",
  "/sredstva-dlya-gigieny-polosti-rta/": "Средства для гигиены полости рта",
  "/sredstva-i-instrumenty-dlya-britya-i-depilyacii/":
    "Средства и инструменты для бритья и депиляции",
  "/dekorativnaya-i-uhodovaya-kosmetika2/":
    "Декоративная и уходовая косметика",
  "/kosmeticheskie-aksessuary/": "Косметические аксессуары",
  "/kosmeticheskie-i-tualetnye-sredstva/":
    "Косметические и туалетные средства",
  "/odnorazovye-sredstva-lichnoy-gigieny/":
    "Одноразовые средства личной гигиены",
  "/apparatnaya-kosmetologiya-i-massazh/":
    "Аппаратная косметология и массаж",
};

const ROOT_BREADCRUMB_TITLE = "Косметика и парфюмерия";

export interface ScopeCheckResult {
  ok: boolean;
  /** Заполняется только при ok=false — для лога. */
  reason?: string;
}

/**
 * Решить, проходит ли товар scope-фильтр.
 *
 * - legacy режим (`startPath` null/undefined или равен `ROOT_CATEGORY_PATH`)
 *   → возвращаем `{ ok: true }` без проверок, поведение прежнее.
 * - island режим:
 *   - пустые / отсутствующие breadcrumbs → out-of-scope;
 *   - root cosmetic title должен присутствовать в breadcrumbs;
 *   - если startPath в `STARTPATH_TO_BREADCRUMB` — соответствующий title
 *     тоже должен присутствовать.
 */
export function isProductInScope(
  product: Pick<ScrapedProduct, "categoryPath">,
  startPath: string | null | undefined,
): ScopeCheckResult {
  if (!startPath || startPath === ROOT_CATEGORY_PATH) {
    return { ok: true };
  }

  const crumbs = product.categoryPath ?? [];
  if (crumbs.length === 0) {
    return { ok: false, reason: "empty categoryPath" };
  }

  const normalizedCrumbs = crumbs.map(normalize);
  const expectedRoot = normalize(ROOT_BREADCRUMB_TITLE);
  if (!normalizedCrumbs.some((c) => c.includes(expectedRoot))) {
    return {
      ok: false,
      reason: `categoryPath missing root "${ROOT_BREADCRUMB_TITLE}"`,
    };
  }

  const expectedTitle = STARTPATH_TO_BREADCRUMB[startPath];
  if (expectedTitle) {
    const expectedNorm = normalize(expectedTitle);
    if (!normalizedCrumbs.some((c) => c.includes(expectedNorm))) {
      return {
        ok: false,
        reason: `categoryPath missing expected "${expectedTitle}"`,
      };
    }
  }

  return { ok: true };
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/ /g, " ") // non-breaking space → обычный
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}
