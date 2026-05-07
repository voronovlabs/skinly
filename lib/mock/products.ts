import type { Product } from "@/lib/types";

/**
 * Mock-каталог продуктов.
 * Phase 2: используется напрямую в RSC. Phase 6: будет заменён на Prisma seed.
 */

export const MOCK_PRODUCTS: Product[] = [
  {
    id: "prod-effaclar",
    barcode: "3337875597197",
    brand: "La Roche-Posay",
    name: "Effaclar Duo (+)",
    category: "Увлажняющий крем",
    emoji: "🧴",
    matchScore: 87,
    verdict: "good",
    verdictTitle: "Отлично подходит вашей коже",
    verdictSubtitle: "На основе вашего профиля: сухая, чувствительная",
    aiExplanation: [
      "Этот продукт хорошо подходит для вашей сухой, чувствительной кожи, потому что содержит керамиды и ниацинамид, которые укрепляют влажный барьер без раздражения.",
      "Однако концентрация салициловой кислоты означает, что стоит вводить её постепенно — сначала дважды в неделю — чтобы избежать переэксфолиации.",
    ],
    ingredients: [
      {
        id: "ing-niacinamide",
        inci: "Niacinamide 4%",
        displayName: "Ниацинамид 4%",
        shortLabel: "Полезен",
        description:
          "Снижает воспаление, регулирует сальность, укрепляет барьер",
        safety: "beneficial",
      },
      {
        id: "ing-procerad",
        inci: "Procerad™",
        displayName: "Procerad™",
        shortLabel: "Против несовершенств",
        description: "Патентованный керамид для профилактики пост-акне",
        safety: "beneficial",
      },
      {
        id: "ing-salicylic",
        inci: "Salicylic Acid 0.5%",
        displayName: "Салициловая кислота 0,5%",
        shortLabel: "С осторожностью",
        description:
          "Эксфолиант — может раздражать чувствительную кожу. Начните с 2 раз в неделю.",
        safety: "caution",
      },
    ],
    compatibility: [
      { label: "Ваш тип кожи (сухая)", status: "compatible", caption: "Совместимо" },
      { label: "Чувствительность", status: "patch_test", caption: "Тест на аллергию" },
      { label: "Цель увлажнения", status: "supports", caption: "Поддерживает" },
      { label: "Проблемы с акне", status: "treats", caption: "Лечит" },
    ],
  },
  {
    id: "prod-cosrx-snail",
    barcode: "8809416470016",
    brand: "COSRX",
    name: "Advanced Snail 96 Mucin",
    category: "Эссенция",
    emoji: "🧴",
    matchScore: 98,
    verdict: "good",
    verdictTitle: "Идеальное совпадение",
    verdictSubtitle: "Деликатный состав, подходит почти всем типам кожи",
    aiExplanation: [
      "Муцин улитки на 96% — мощный увлажняющий и репаративный комплекс. Отлично восстанавливает барьер сухой и чувствительной кожи.",
      "Минимум активов и отдушек — очень низкий риск раздражения.",
    ],
    ingredients: [
      {
        id: "ing-snail-mucin",
        inci: "Snail Secretion Filtrate 96%",
        displayName: "Муцин улитки 96%",
        shortLabel: "Полезен",
        description: "Глубокое увлажнение и восстановление",
        safety: "beneficial",
      },
      {
        id: "ing-betaine",
        inci: "Betaine",
        displayName: "Бетаин",
        shortLabel: "Полезен",
        description: "Удерживает влагу в роговом слое",
        safety: "beneficial",
      },
      {
        id: "ing-allantoin",
        inci: "Allantoin",
        displayName: "Аллантоин",
        shortLabel: "Успокаивает",
        description: "Смягчает и снимает раздражение",
        safety: "beneficial",
      },
    ],
    compatibility: [
      { label: "Ваш тип кожи (сухая)", status: "supports", caption: "Поддерживает" },
      { label: "Чувствительность", status: "compatible", caption: "Совместимо" },
      { label: "Цель увлажнения", status: "supports", caption: "Поддерживает" },
    ],
  },
  {
    id: "prod-paulas-bha",
    barcode: "0655439020201",
    brand: "Paula's Choice",
    name: "2% BHA Liquid",
    category: "Эксфолиант",
    emoji: "🌿",
    matchScore: 95,
    verdict: "good",
    verdictTitle: "Хорошо подходит, но осторожно",
    verdictSubtitle: "Активная BHA — вводите постепенно",
    aiExplanation: [
      "Эталонный салициловый эксфолиант. Помогает с порами и пост-воспалительной пигментацией.",
      "При высокой чувствительности — начинайте с 2 раз в неделю и обязательно SPF днём.",
    ],
    ingredients: [
      {
        id: "ing-bha-2",
        inci: "Salicylic Acid 2%",
        displayName: "Салициловая кислота 2%",
        shortLabel: "С осторожностью",
        description: "Растворяет ороговевшие клетки и очищает поры",
        safety: "caution",
      },
      {
        id: "ing-green-tea",
        inci: "Camellia Sinensis Leaf Extract",
        displayName: "Зелёный чай",
        shortLabel: "Антиоксидант",
        description: "Защищает кожу от свободных радикалов",
        safety: "beneficial",
      },
      {
        id: "ing-methylpropanediol",
        inci: "Methylpropanediol",
        displayName: "Метилпропандиол",
        shortLabel: "Нейтрален",
        description: "Носитель, помогает доставить активы",
        safety: "neutral",
      },
    ],
    compatibility: [
      { label: "Ваш тип кожи (сухая)", status: "patch_test", caption: "Тест на аллергию" },
      { label: "Чувствительность", status: "warning", caption: "Осторожно" },
      { label: "Проблемы с акне", status: "treats", caption: "Лечит" },
      { label: "Поры", status: "treats", caption: "Лечит" },
    ],
  },
  {
    id: "prod-ordinary-ha",
    barcode: "0769915190656",
    brand: "The Ordinary",
    name: "Hyaluronic Acid 2% + B5",
    category: "Сыворотка",
    emoji: "💧",
    matchScore: 92,
    verdict: "good",
    verdictTitle: "Отличное увлажнение",
    verdictSubtitle: "Подходит для дневного и вечернего ухода",
    aiExplanation: [
      "Три молекулярных веса гиалуроновой кислоты + витамин B5 — глубокое увлажнение на разных уровнях кожи.",
      "Лучше всего работает на чуть влажной коже под крем.",
    ],
    ingredients: [
      {
        id: "ing-ha",
        inci: "Sodium Hyaluronate Crosspolymer",
        displayName: "Гиалуроновая кислота",
        shortLabel: "Полезен",
        description: "Связывает влагу в роговом слое",
        safety: "beneficial",
      },
      {
        id: "ing-b5",
        inci: "Panthenol",
        displayName: "Пантенол (B5)",
        shortLabel: "Полезен",
        description: "Успокаивает и поддерживает барьер",
        safety: "beneficial",
      },
    ],
    compatibility: [
      { label: "Ваш тип кожи (сухая)", status: "supports", caption: "Поддерживает" },
      { label: "Цель увлажнения", status: "supports", caption: "Поддерживает" },
    ],
  },
  {
    id: "prod-biore-uv",
    barcode: "4901301298386",
    brand: "Biore",
    name: "UV Aqua Rich SPF50",
    category: "Солнцезащитный крем",
    emoji: "☀️",
    matchScore: 72,
    verdict: "caution",
    verdictTitle: "Подходит, но проверьте на аллергию",
    verdictSubtitle: "В составе есть отдушки — для чувствительной кожи нужен patch test",
    aiExplanation: [
      "Лёгкая текстура и высокий SPF50 — хорошая базовая защита от UV.",
      "Содержит отдушку, что вы указали в списке избегаемых ингредиентов. Сделайте patch test перед регулярным применением.",
    ],
    ingredients: [
      {
        id: "ing-uv-filter",
        inci: "Ethylhexyl Methoxycinnamate",
        displayName: "UV-фильтр (Octinoxate)",
        shortLabel: "Защита",
        description: "Стабильный UVB-фильтр",
        safety: "neutral",
      },
      {
        id: "ing-fragrance",
        inci: "Parfum",
        displayName: "Отдушка",
        shortLabel: "Избегайте",
        description: "Может вызвать раздражение, особенно у чувствительной кожи",
        safety: "danger",
      },
    ],
    compatibility: [
      { label: "Ваш тип кожи (сухая)", status: "compatible", caption: "Совместимо" },
      { label: "Чувствительность", status: "warning", caption: "Осторожно" },
      { label: "Избегаете отдушек", status: "incompatible", caption: "Не подходит" },
    ],
  },
];

export function findProductByBarcode(barcode: string): Product | undefined {
  return MOCK_PRODUCTS.find((p) => p.barcode === barcode);
}

export function findProductById(id: string): Product | undefined {
  return MOCK_PRODUCTS.find((p) => p.id === id);
}
