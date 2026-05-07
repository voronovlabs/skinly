# Skinly MVP

У нас есть UI-прототип в `index.html`.
Нужно превратить его в production-ready MVP веб-приложение.

## Цель
Skinly — персональный AI beauty-assistant для подбора косметики по штрихкоду, составу, типу кожи и истории пользователя.

## Важно
- Не ломать текущий visual style.
- Русский язык по умолчанию.
- Переключатель RU/EN сохранить.
- Mobile-first, но desktop тоже должен выглядеть хорошо.
- Текущий HTML использовать как главный UI-референс.
- Не делать просто статическую страницу — нужна нормальная архитектура приложения.

## Стек
- Next.js
- TypeScript
- Tailwind CSS
- PostgreSQL
- Prisma
- Auth: email/password + guest mode
- Barcode scanner: html5-qrcode или ZXing
- Docker + docker-compose

## MVP-функции
1. Welcome screen
2. Auth: регистрация, вход, гостевой режим
3. Onboarding профиля кожи
4. Dashboard
5. Scanner screen
6. Поиск товара по barcode
7. Product analysis page
8. Scan history
9. Favorites
10. User profile
11. Admin seed/import demo products
12. i18n RU/EN

## Backend сущности
- User
- SkinProfile
- Product
- Ingredient
- ProductIngredient
- ScanHistory
- Favorite
- UserProductRating

## Что сделать
1. Создай полноценный Next.js проект.
2. Разбей HTML на компоненты.
3. Сделай роутинг.
4. Подключи Prisma/PostgreSQL.
5. Сделай API endpoints.
6. Добавь seed с демо-товарами.
7. Сделай scanner mock + подготовь реальное подключение камеры.
8. Сделай Dockerfile и docker-compose.yml.
9. Добавь README с запуском локально и деплоем.

## Первый запрос к Claude

Прочитай CLAUDE.md и index.html. Сначала составь короткий план реализации MVP, потом начинай создавать проект. Не меняй визуальный стиль без необходимости.

