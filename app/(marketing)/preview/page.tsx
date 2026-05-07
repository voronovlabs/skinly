"use client";

import { useState } from "react";
import { Plus, Heart } from "lucide-react";
import {
  Button,
  Card,
  Tag,
  Input,
  Toggle,
  ProgressBar,
  MatchRing,
  LanguageSwitcher,
  type AppLocale,
} from "@/components/ui";
import { BottomNav, ScreenContainer } from "@/components/layout";

/**
 * /preview — dev-страница для визуальной верификации UI primitives.
 * Не входит в публичный навигационный flow. После Phase 2 (static screens)
 * можно удалить или скрыть за фича-флагом.
 */
export default function PreviewPage() {
  const [push, setPush] = useState(true);
  const [email, setEmail] = useState(false);
  const [dark, setDark] = useState(false);
  const [locale, setLocale] = useState<AppLocale>("ru");
  const [filter, setFilter] = useState<"all" | "favorites" | "good" | "caution">(
    "all",
  );

  return (
    <ScreenContainer padded withBottomNav>
      <header className="py-6">
        <p className="text-caption text-muted-graphite">UI Components</p>
        <h1 className="text-h1 mt-1">Preview</h1>
        <p className="text-body-sm text-muted-graphite mt-1">
          Phase 1 · все primitives на одном экране
        </p>
      </header>

      <Section title="Buttons">
        <div className="space-y-3">
          <Button variant="primary">Сканировать продукт</Button>
          <Button variant="secondary">Продолжить как гость</Button>
          <Button variant="ghost">Скрытое действие</Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
        </div>
        <div className="mt-3 flex gap-3">
          <Button variant="secondary" size="icon" aria-label="like">
            <Heart className="h-5 w-5" strokeWidth={2} />
          </Button>
          <Button variant="secondary" size="icon" aria-label="add">
            <Plus className="h-5 w-5" strokeWidth={2} />
          </Button>
          <Button variant="primary" size="icon" aria-label="add">
            <Plus className="h-5 w-5" strokeWidth={2.5} />
          </Button>
        </div>
      </Section>

      <Section title="Cards">
        <div className="space-y-3">
          <Card>
            <div className="text-h3">Card · default</div>
            <p className="text-body-sm text-muted-graphite mt-1">
              shadow-soft-md, rounded-lg, p-6 — стандартный контейнер.
            </p>
          </Card>
          <Card interactive>
            <div className="text-h3">Card · interactive</div>
            <p className="text-body-sm text-muted-graphite mt-1">
              Hover lift на 2px и усиленная тень.
            </p>
          </Card>
          <div className="rounded-lg bg-gradient-to-br from-soft-lavender to-premium-peach p-2">
            <Card variant="glass">
              <div className="text-h3">Card · glass</div>
              <p className="text-body-sm text-muted-graphite mt-1">
                Backdrop-blur поверх цветного фона.
              </p>
            </Card>
          </div>
        </div>
      </Section>

      <Section title="Tags">
        <div className="flex flex-wrap gap-2">
          <Tag tone="neutral">Neutral</Tag>
          <Tag tone="active">Active</Tag>
          <Tag tone="success">Полезен</Tag>
          <Tag tone="warning">С осторожностью</Tag>
          <Tag tone="danger">Опасно</Tag>
          <Tag tone="premium">Premium</Tag>
        </div>
        <div className="mt-4">
          <p className="text-caption text-muted-graphite mb-2">Filter group</p>
          <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
            {(["all", "favorites", "good", "caution"] as const).map((key) => (
              <Tag
                key={key}
                interactive
                selected={filter === key}
                onClick={() => setFilter(key)}
              >
                {labelByFilter[key]}
              </Tag>
            ))}
          </div>
        </div>
      </Section>

      <Section title="Input">
        <div className="space-y-3">
          <Input placeholder="Поиск продуктов…" />
          <Input placeholder="Email" type="email" />
          <Input placeholder="Disabled" disabled />
        </div>
      </Section>

      <Section title="Toggle">
        <div className="space-y-3">
          <Row label="Push-уведомления">
            <Toggle
              checked={push}
              onCheckedChange={setPush}
              aria-label="Push-уведомления"
            />
          </Row>
          <Row label="Email-рассылка">
            <Toggle
              checked={email}
              onCheckedChange={setEmail}
              aria-label="Email-рассылка"
            />
          </Row>
          <Row label="Тёмная тема">
            <Toggle
              checked={dark}
              onCheckedChange={setDark}
              aria-label="Тёмная тема"
            />
          </Row>
        </div>
      </Section>

      <Section title="ProgressBar">
        <div className="space-y-4">
          <ProgressBarRow value={20} caption="Шаг 1 из 5" />
          <ProgressBarRow value={75} caption="Профиль заполнен на 75%" />
          <ProgressBarRow value={100} caption="Готово" />
        </div>
      </Section>

      <Section title="MatchRing">
        <div className="flex flex-wrap items-center gap-6">
          <MatchRing value={87} />
          <MatchRing value={98} />
          <MatchRing value={72} />
          <MatchRing value={45} size={60} strokeWidth={5} />
        </div>
      </Section>

      <Section title="LanguageSwitcher">
        <Row label={`Локаль: ${locale.toUpperCase()}`}>
          <LanguageSwitcher value={locale} onChange={setLocale} />
        </Row>
      </Section>

      <Section title="ScreenContainer + BottomNav">
        <p className="text-body-sm text-muted-graphite">
          Эта страница уже использует <code>ScreenContainer</code> (max-width
          480, fade-in, padding под BottomNav). Внизу видна сама панель —
          активная вкладка <strong>Профиль</strong>.
        </p>
      </Section>

      <BottomNav active="profile" />
    </ScreenContainer>
  );
}

/* ───────── helpers (локальные, только для этой dev-страницы) ───────── */

const labelByFilter = {
  all: "Все",
  favorites: "Избранное",
  good: "Хорошая совместимость",
  caution: "С осторожностью",
} as const;

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-h3 text-graphite mb-3">{title}</h2>
      {children}
    </section>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md bg-pure-white px-4 py-3 shadow-soft-sm">
      <span className="text-body-sm text-graphite">{label}</span>
      {children}
    </div>
  );
}

function ProgressBarRow({
  value,
  caption,
}: {
  value: number;
  caption: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-caption text-muted-graphite">{caption}</span>
        <span className="text-caption text-lavender-deep">{value}%</span>
      </div>
      <ProgressBar value={value} aria-label={caption} />
    </div>
  );
}
