import Link from "next/link";
import type { Metadata } from "next";

/**
 * /privacy — публичная страница «Политика конфиденциальности».
 *
 * Server Component без зависимостей от next-intl: текст русский, статичный,
 * не требует переключения локали (App Store / Google Play и Yandex Webmaster
 * чаще всего проверяют именно RU-вариант).
 *
 * Middleware не защищает `/privacy` (нет в PROTECTED_PREFIXES) — страница
 * доступна и анониму, и гостю, и user'у.
 */

export const metadata: Metadata = {
  title: "Политика конфиденциальности — Skinly",
  description:
    "Какие данные собирает Skinly, как мы их используем, и как запросить удаление.",
};

const UPDATED_AT = "1 июня 2026";
const SUPPORT_EMAIL = "maksimys888@yandex.ru";

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-warm-white text-graphite animate-fade-in">
      <div className="mx-auto w-full max-w-[640px] px-6 pb-20 pt-10 md:px-8">
        {/* Header */}
        <header className="flex items-center justify-between">
          <Link
            href="/welcome"
            className="text-h3 font-medium tracking-tight text-graphite transition hover:text-lavender-deep"
          >
            Skinly
          </Link>
          <Link
            href="/welcome"
            className="text-body-sm text-muted-graphite transition hover:text-graphite"
          >
            ← На главную
          </Link>
        </header>

        {/* Title */}
        <div className="mt-10 md:mt-14">
          <p className="text-caption text-lavender-deep">ДОКУМЕНТ</p>
          <h1 className="mt-2 text-display text-graphite">
            Политика конфиденциальности
          </h1>
          <p className="mt-3 text-body text-muted-graphite">
            Последнее обновление: {UPDATED_AT}
          </p>
        </div>

        {/* Intro */}
        <p className="mt-8 text-body text-muted-graphite">
          Skinly — это персональный AI-ассистент по уходу за кожей и волосами.
          Мы создаём продукт, которому хочется доверять, и относимся к вашим
          данным как к чему-то личному. Ниже — простыми словами, что именно мы
          собираем, зачем, и какие у вас есть права.
        </p>

        {/* Sections */}
        <Section title="1. Какие данные мы собираем">
          <p>В минимальном объёме, нужном для работы приложения:</p>
          <List
            items={[
              <>
                <strong className="font-semibold text-graphite">
                  Аккаунт:
                </strong>{" "}
                email, имя (если вы его указали) и хэш пароля. Сам пароль мы
                не храним и не видим.
              </>,
              <>
                <strong className="font-semibold text-graphite">
                  Профиль кожи и волос:
                </strong>{" "}
                ответы анкеты онбординга — тип кожи, чувствительность,
                концерны, предпочтения по составу, цели ухода.
              </>,
              <>
                <strong className="font-semibold text-graphite">
                  История сканов и избранное:
                </strong>{" "}
                штрихкоды отсканированных продуктов и время скана; продукты,
                которые вы отметили сердечком.
              </>,
              <>
                <strong className="font-semibold text-graphite">
                  Язык интерфейса:
                </strong>{" "}
                ru или en, в cookie.
              </>,
              <>
                <strong className="font-semibold text-graphite">
                  Гостевой режим:
                </strong>{" "}
                если вы пользуетесь Skinly без аккаунта, профиль и история
                хранятся <em>только в вашем браузере</em> (localStorage).
                Мы их не получаем.
              </>,
            ]}
          />
          <p className="mt-4">
            Мы <strong className="font-semibold text-graphite">не собираем</strong>{" "}
            фотографии вашей кожи, не используем рекламные трекеры, не запрашиваем
            доступ к контактам, геолокации или микрофону. Камера используется
            только для считывания штрихкодов и никогда не передаёт изображения
            на сервер.
          </p>
        </Section>

        <Section title="2. Зачем мы используем эти данные">
          <List
            items={[
              <>
                Чтобы рассчитывать совместимость состава с вашим профилем
                кожи и волос.
              </>,
              <>Чтобы показывать историю сканов и избранное на ваших устройствах.</>,
              <>
                Чтобы поддерживать вход в аккаунт (сессия, защита от
                несанкционированного доступа).
              </>,
              <>
                Чтобы улучшать продукт: видеть, какие функции работают, а
                какие — нет (агрегированно, без привязки к личности).
              </>,
            ]}
          />
        </Section>

        <Section title="3. Мы не продаём данные">
          <p>
            Skinly{" "}
            <strong className="font-semibold text-graphite">
              не продаёт, не сдаёт в аренду и не передаёт
            </strong>{" "}
            ваши персональные данные третьим лицам для рекламы или маркетинга.
            Никаких рекламных SDK, никаких ретаргетинговых пикселей.
          </p>
          <p>
            Мы используем минимальный набор технических подрядчиков (хостинг
            базы данных и серверов) и обмениваемся с ними только тем, что
            необходимо для работы сервиса. У этих подрядчиков нет прав
            использовать ваши данные в собственных целях.
          </p>
        </Section>

        <Section title="4. Ваши права">
          <List
            items={[
              <>
                <strong className="font-semibold text-graphite">
                  Запросить удаление аккаунта и всех связанных данных.
                </strong>{" "}
                После запроса мы безвозвратно удаляем профиль, историю,
                избранное и каскадно — все ссылки на ваш аккаунт. Срок:
                до 14 дней.
              </>,
              <>
                <strong className="font-semibold text-graphite">
                  Получить копию ваших данных
                </strong>{" "}
                в машиночитаемом формате (JSON).
              </>,
              <>
                <strong className="font-semibold text-graphite">
                  Исправить или обновить
                </strong>{" "}
                ответы анкеты — в любой момент в разделе «Профиль».
              </>,
              <>
                <strong className="font-semibold text-graphite">
                  Отозвать согласие
                </strong>{" "}
                на обработку и перейти в гостевой режим без аккаунта.
              </>,
            ]}
          />
          <p className="mt-4">
            Чтобы реализовать любое из этих прав, напишите нам с email,
            привязанного к аккаунту — на адрес из раздела «Контакты» ниже.
          </p>
        </Section>

        <Section title="5. Хранение и безопасность">
          <p>
            Данные хранятся в PostgreSQL на серверах в Европейском регионе.
            Соединения защищены TLS. Пароли захэшированы алгоритмом bcrypt.
            Сессионные токены подписаны и хранятся в HttpOnly cookie.
          </p>
          <p>
            Срок хранения — пока ваш аккаунт активен. Если вы не входите в
            аккаунт более 24 месяцев, мы свяжемся с вами и при отсутствии
            ответа удалим неактивный аккаунт.
          </p>
        </Section>

        <Section title="6. Изменения этой политики">
          <p>
            Если мы вносим существенные изменения, мы обновляем дату
            «Последнее обновление» в начале документа и, при необходимости,
            уведомляем пользователей по email или внутри приложения.
          </p>
        </Section>

        {/* Contacts — выделенная карточка */}
        <section
          aria-labelledby="contacts"
          className="mt-12 rounded-xl border border-border-soft bg-pure-white p-6 shadow-soft-sm md:p-8"
        >
          <p className="text-caption text-lavender-deep">КОНТАКТЫ</p>
          <h2 id="contacts" className="mt-2 text-h2 text-graphite">
            Связаться с нами
          </h2>
          <p className="mt-3 text-body text-muted-graphite">
            По любым вопросам, связанным с этой политикой, обработкой данных
            или удалением аккаунта, пишите на адрес ниже. Отвечаем в течение
            5 рабочих дней.
          </p>
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="
              mt-5 inline-flex items-center gap-2 rounded-full
              bg-graphite px-6 py-3 text-sm font-semibold text-pure-white
              shadow-soft-md transition hover:scale-[1.02] hover:shadow-soft-lg active:scale-[0.98]
            "
          >
            {SUPPORT_EMAIL}
          </a>
        </section>

        <footer className="mt-12 border-t border-border-soft pt-6 text-body-sm text-light-graphite">
          © {new Date().getFullYear()} Skinly. Сделано с уважением к вашим данным.
        </footer>
      </div>
    </main>
  );
}

/* ─────────── Локальные UI-хелперы ─────────── */

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <h2 className="text-h2 text-graphite">{title}</h2>
      <div className="mt-3 space-y-3 text-body text-muted-graphite">
        {children}
      </div>
    </section>
  );
}

function List({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="mt-3 space-y-2.5">
      {items.map((node, i) => (
        <li key={i} className="flex gap-3">
          <span
            aria-hidden
            className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-lavender-deep"
          />
          <span className="text-body text-muted-graphite">{node}</span>
        </li>
      ))}
    </ul>
  );
}
