-- =============================================================================
-- Skinly · DM (Silver) layer · SEED канонических ингредиентов + алиасов
--
-- Источник правды seed'а — lib/compatibility/ingredients.ts (~46 ингредиентов KB)
-- + базовые RU/EN-синонимы (aqua/water/вода, parfum/отдушка, …).
--
-- Идемпотентно: повторный запуск обновляет справочники (ON CONFLICT DO UPDATE),
-- алиасы добавляет без дублей (ON CONFLICT DO NOTHING). Все алиасы проходят
-- через dm.norm_ingredient_alias(), поэтому хранятся в одной нормальной форме.
--
-- Зависит от: 30_ingredients_canonical.sql.
-- Запуск:
--   psql "$DATABASE_URL" -f sql/dm/31_seed_ingredient_aliases.sql
-- =============================================================================

-- ─────────────────────────── 1. Canonical ─────────────────────────────────────
INSERT INTO dm.ingredients_canonical (canonical_id, inci_name, display_ru, display_en, is_junk) VALUES
  ('water',               'Aqua',                              'Вода',                   'Water',                     false),
  ('sodium_hyaluronate',  'Sodium Hyaluronate',                'Гиалуронат натрия',      'Sodium Hyaluronate',        false),
  ('glycerin',            'Glycerin',                          'Глицерин',               'Glycerin',                  false),
  ('panthenol',           'Panthenol',                         'Пантенол',               'Panthenol',                 false),
  ('betaine',             'Betaine',                           'Бетаин',                 'Betaine',                   false),
  ('ceramide_np',         'Ceramide NP',                       'Церамид',                'Ceramide NP',               false),
  ('squalane',            'Squalane',                          'Сквалан',                'Squalane',                  false),
  ('snail_mucin',         'Snail Secretion Filtrate',          'Муцин улитки',           'Snail Secretion Filtrate',  false),
  ('allantoin',           'Allantoin',                         'Аллантоин',              'Allantoin',                 false),
  ('centella',            'Centella Asiatica Extract',         'Центелла азиатская',     'Centella Asiatica',         false),
  ('niacinamide',         'Niacinamide',                       'Ниацинамид',             'Niacinamide',               false),
  ('salicylic_acid',      'Salicylic Acid',                    'Салициловая кислота',    'Salicylic Acid',            false),
  ('glycolic_acid',       'Glycolic Acid',                     'Гликолевая кислота',     'Glycolic Acid',             false),
  ('lactic_acid',         'Lactic Acid',                       'Молочная кислота',       'Lactic Acid',               false),
  ('mandelic_acid',       'Mandelic Acid',                     'Миндальная кислота',     'Mandelic Acid',             false),
  ('azelaic_acid',        'Azelaic Acid',                      'Азелаиновая кислота',    'Azelaic Acid',              false),
  ('citric_acid',         'Citric Acid',                       'Лимонная кислота',       'Citric Acid',               false),
  ('retinol',             'Retinol',                           'Ретинол',                'Retinol',                   false),
  ('bakuchiol',           'Bakuchiol',                         'Бакучиол',               'Bakuchiol',                 false),
  ('vitamin_c',           'Ascorbic Acid',                     'Витамин C',              'Vitamin C',                 false),
  ('tocopherol',          'Tocopherol',                        'Витамин E',              'Tocopherol',                false),
  ('zinc_pca',            'Zinc PCA',                          'Цинк PCA',               'Zinc PCA',                  false),
  ('tea_tree_oil',        'Melaleuca Alternifolia Leaf Oil',   'Масло чайного дерева',   'Tea Tree Oil',              false),
  ('green_tea',           'Camellia Sinensis Leaf Extract',    'Экстракт зелёного чая',  'Green Tea Extract',         false),
  ('fragrance',           'Parfum',                            'Отдушка',                'Fragrance',                 false),
  ('linalool',            'Linalool',                          'Линалоол',               'Linalool',                  false),
  ('limonene',            'Limonene',                          'Лимонен',                'Limonene',                  false),
  ('alcohol_denat',       'Alcohol Denat',                     'Денатурированный спирт', 'Alcohol Denat',             false),
  ('isopropyl_alcohol',   'Isopropyl Alcohol',                 'Изопропиловый спирт',    'Isopropyl Alcohol',         false),
  ('sls',                 'Sodium Lauryl Sulfate',             'Лаурилсульфат натрия',   'Sodium Lauryl Sulfate',     false),
  ('sles',                'Sodium Laureth Sulfate',            'Лауретсульфат натрия',   'Sodium Laureth Sulfate',    false),
  ('methylparaben',       'Methylparaben',                     'Метилпарабен',           'Methylparaben',             false),
  ('lavender_oil',        'Lavandula Angustifolia Oil',        'Масло лаванды',          'Lavender Oil',              false),
  ('peppermint_oil',      'Mentha Piperita Oil',               'Масло мяты перечной',    'Peppermint Oil',            false),
  ('eucalyptus_oil',      'Eucalyptus Globulus Oil',           'Масло эвкалипта',        'Eucalyptus Oil',            false),
  ('coconut_oil',         'Cocos Nucifera Oil',                'Кокосовое масло',        'Coconut Oil',               false),
  ('isopropyl_myristate', 'Isopropyl Myristate',               'Изопропилмиристат',      'Isopropyl Myristate',       false),
  ('shea_butter',         'Butyrospermum Parkii Butter',       'Масло ши',               'Shea Butter',               false),
  ('petrolatum',          'Petrolatum',                        'Вазелин',                'Petrolatum',                false),
  ('mineral_oil',         'Mineral Oil',                       'Минеральное масло',      'Mineral Oil',               false),
  ('zinc_oxide',          'Zinc Oxide',                        'Оксид цинка',            'Zinc Oxide',                false),
  ('titanium_dioxide',    'Titanium Dioxide',                  'Диоксид титана',         'Titanium Dioxide',          false),
  ('octinoxate',          'Ethylhexyl Methoxycinnamate',       'Октиноксат',             'Octinoxate',                false),
  ('avobenzone',          'Butyl Methoxydibenzoylmethane',     'Авобензон',              'Avobenzone',                false),
  -- мусорный «канонический» bucket — не-ингредиент / маркетинговая строка
  ('junk',                NULL,                                '—',                      '—',                         true)
ON CONFLICT (canonical_id) DO UPDATE SET
  inci_name  = EXCLUDED.inci_name,
  display_ru = EXCLUDED.display_ru,
  display_en = EXCLUDED.display_en,
  is_junk    = EXCLUDED.is_junk;

-- ─────────────────────────── 2. Properties ────────────────────────────────────
-- comedogenicity 0..5 · irritancy 0..3 · allergenicity 0..3 — seed-эвристики.
INSERT INTO dm.ingredient_properties
  (canonical_id, functions, tags, benefits_for, cautions_for, flags_avoided,
   comedogenicity, irritancy, allergenicity, pregnancy_caution) VALUES
  ('water',               '{solvent}',                  '{}',                                       '{}',                              '{}',                 '{}',               0,0,0,false),
  ('sodium_hyaluronate',  '{humectant}',                '{humectant,barrier}',                      '{}',                              '{}',                 '{}',               0,0,0,false),
  ('glycerin',            '{humectant}',                '{humectant}',                              '{}',                              '{}',                 '{}',               0,0,0,false),
  ('panthenol',           '{humectant,soothing}',       '{humectant,soothing,barrier}',             '{}',                              '{}',                 '{}',               0,0,0,false),
  ('betaine',             '{humectant}',                '{humectant}',                              '{}',                              '{}',                 '{}',               0,0,0,false),
  ('ceramide_np',         '{emollient,occlusive}',      '{barrier,occlusive}',                      '{aging}',                         '{}',                 '{}',               0,0,0,false),
  ('squalane',            '{emollient,occlusive}',      '{occlusive}',                              '{}',                              '{}',                 '{}',               1,0,0,false),
  ('snail_mucin',         '{humectant,soothing}',       '{humectant,barrier,soothing}',             '{}',                              '{}',                 '{}',               0,0,1,false),
  ('allantoin',           '{soothing}',                 '{soothing}',                               '{}',                              '{}',                 '{}',               0,0,0,false),
  ('centella',            '{soothing,antioxidant}',     '{soothing,antioxidant}',                   '{redness}',                       '{}',                 '{}',               0,0,1,false),
  ('niacinamide',         '{active,antioxidant}',       '{active,barrier,antioxidant}',             '{acne,redness,pigmentation,pores}','{}',                '{}',               0,1,0,false),
  ('salicylic_acid',      '{active,exfoliant}',         '{active,exfoliant_bha}',                   '{acne,blackheads,pores}',         '{}',                 '{}',               0,2,1,true),
  ('glycolic_acid',       '{active,exfoliant}',         '{active,exfoliant_aha}',                   '{pigmentation,aging}',            '{}',                 '{}',               0,2,1,false),
  ('lactic_acid',         '{active,exfoliant,humectant}','{active,exfoliant_aha,humectant}',        '{pigmentation,aging}',            '{}',                 '{}',               0,2,1,false),
  ('mandelic_acid',       '{active,exfoliant}',         '{active,exfoliant_aha}',                   '{pigmentation,acne}',             '{}',                 '{}',               0,1,1,false),
  ('azelaic_acid',        '{active}',                   '{active}',                                 '{acne,redness,pigmentation}',     '{}',                 '{}',               0,1,0,false),
  ('citric_acid',         '{exfoliant,ph_adjuster}',    '{exfoliant_aha}',                          '{}',                              '{}',                 '{}',               0,1,0,false),
  ('retinol',             '{active}',                   '{active,retinoid}',                        '{aging,acne,pigmentation}',       '{}',                 '{}',               0,2,1,true),
  ('bakuchiol',           '{active,antioxidant}',       '{active,antioxidant}',                     '{aging}',                         '{}',                 '{}',               0,1,0,false),
  ('vitamin_c',           '{active,antioxidant}',       '{active,vitamin_c,antioxidant}',           '{pigmentation,aging}',            '{}',                 '{}',               0,1,0,false),
  ('tocopherol',          '{antioxidant,emollient}',    '{antioxidant}',                            '{}',                              '{}',                 '{}',               1,0,1,false),
  ('zinc_pca',            '{active}',                   '{active}',                                 '{acne,pores}',                    '{}',                 '{}',               0,0,0,false),
  ('tea_tree_oil',        '{active,fragrance}',         '{essential_oil}',                          '{acne}',                          '{redness}',          '{essential_oils}', 0,2,2,false),
  ('green_tea',           '{antioxidant,soothing}',     '{antioxidant,soothing}',                   '{redness,aging}',                 '{}',                 '{}',               0,0,0,false),
  ('fragrance',           '{fragrance}',                '{fragrance}',                              '{}',                              '{redness}',          '{fragrance}',      0,1,3,false),
  ('linalool',            '{fragrance}',                '{fragrance}',                              '{}',                              '{}',                 '{fragrance}',      0,1,3,false),
  ('limonene',            '{fragrance}',                '{fragrance}',                              '{}',                              '{}',                 '{fragrance}',      0,1,3,false),
  ('alcohol_denat',       '{solvent}',                  '{alcohol_drying}',                         '{}',                              '{}',                 '{alcohol}',        0,2,0,false),
  ('isopropyl_alcohol',   '{solvent}',                  '{alcohol_drying}',                         '{}',                              '{}',                 '{alcohol}',        0,2,0,false),
  ('sls',                 '{surfactant}',               '{sulfate_surfactant}',                     '{}',                              '{}',                 '{sulfates}',       0,3,1,false),
  ('sles',                '{surfactant}',               '{sulfate_surfactant}',                     '{}',                              '{}',                 '{sulfates}',       0,2,1,false),
  ('methylparaben',       '{preservative}',             '{paraben}',                                '{}',                              '{}',                 '{parabens}',       0,0,1,false),
  ('lavender_oil',        '{fragrance}',                '{essential_oil,fragrance}',                '{}',                              '{redness}',          '{essential_oils}', 0,2,3,false),
  ('peppermint_oil',      '{fragrance}',                '{essential_oil}',                          '{}',                              '{redness}',          '{essential_oils}', 0,2,2,false),
  ('eucalyptus_oil',      '{fragrance}',                '{essential_oil}',                          '{}',                              '{}',                 '{essential_oils}', 0,2,2,false),
  ('coconut_oil',         '{emollient,occlusive}',      '{comedogenic_oil,occlusive,heavy_oil}',    '{}',                              '{acne,blackheads}',  '{}',               4,0,0,false),
  ('isopropyl_myristate', '{emollient}',                '{comedogenic_oil}',                        '{}',                              '{acne}',             '{}',               5,1,0,false),
  ('shea_butter',         '{emollient,occlusive}',      '{heavy_oil,occlusive}',                    '{}',                              '{}',                 '{}',               2,0,0,false),
  ('petrolatum',          '{occlusive}',                '{occlusive,heavy_oil}',                    '{}',                              '{}',                 '{}',               0,0,0,false),
  ('mineral_oil',         '{occlusive}',                '{occlusive,heavy_oil}',                    '{}',                              '{}',                 '{}',               1,0,0,false),
  ('zinc_oxide',          '{uv_filter}',                '{physical_filter}',                        '{}',                              '{}',                 '{}',               1,0,0,false),
  ('titanium_dioxide',    '{uv_filter}',                '{physical_filter}',                        '{}',                              '{}',                 '{}',               0,0,0,false),
  ('octinoxate',          '{uv_filter}',                '{chemical_filter}',                        '{}',                              '{}',                 '{}',               0,1,1,false),
  ('avobenzone',          '{uv_filter}',                '{chemical_filter}',                        '{}',                              '{}',                 '{}',               0,1,1,false)
ON CONFLICT (canonical_id) DO UPDATE SET
  functions         = EXCLUDED.functions,
  tags              = EXCLUDED.tags,
  benefits_for      = EXCLUDED.benefits_for,
  cautions_for      = EXCLUDED.cautions_for,
  flags_avoided     = EXCLUDED.flags_avoided,
  comedogenicity    = EXCLUDED.comedogenicity,
  irritancy         = EXCLUDED.irritancy,
  allergenicity     = EXCLUDED.allergenicity,
  pregnancy_caution = EXCLUDED.pregnancy_caution;

-- ─────────────────────────── 3. Aliases ───────────────────────────────────────
-- Все варианты написания (RU/EN/синонимы). Нормализуются через
-- dm.norm_ingredient_alias() прямо при вставке → одна форма хранения.
INSERT INTO dm.ingredient_aliases (alias_norm, canonical_id, lang, source)
SELECT n, cid, lang, 'seed'
FROM (
  SELECT dm.norm_ingredient_alias(a) AS n, cid, lang
  FROM (VALUES
    -- water
    ('aqua','water','en'), ('water','water','en'), ('aqua water','water','en'),
    ('purified water','water','en'), ('eau','water','en'),
    ('вода','water','ru'), ('вода очищенная','water','ru'),
    ('деионизированная вода','water','ru'), ('вода деминерализованная','water','ru'),
    -- sodium hyaluronate
    ('sodium hyaluronate','sodium_hyaluronate','en'), ('hyaluronic acid','sodium_hyaluronate','en'),
    ('hydrolyzed hyaluronic acid','sodium_hyaluronate','en'),
    ('sodium hyaluronate crosspolymer','sodium_hyaluronate','en'),
    ('гиалуронат натрия','sodium_hyaluronate','ru'), ('гиалуроновая кислота','sodium_hyaluronate','ru'),
    -- glycerin
    ('glycerin','glycerin','en'), ('glycerine','glycerin','en'), ('глицерин','glycerin','ru'),
    -- panthenol
    ('panthenol','panthenol','en'), ('d-panthenol','panthenol','en'),
    ('pantothenic acid','panthenol','en'), ('vitamin b5','panthenol','en'),
    ('пантенол','panthenol','ru'), ('провитамин b5','panthenol','ru'),
    -- betaine
    ('betaine','betaine','en'), ('бетаин','betaine','ru'),
    -- ceramide
    ('ceramide np','ceramide_np','en'), ('ceramide','ceramide_np','en'),
    ('ceramide ap','ceramide_np','en'), ('ceramide eop','ceramide_np','en'),
    ('phytoceramides','ceramide_np','en'), ('церамид','ceramide_np','ru'), ('церамиды','ceramide_np','ru'),
    -- squalane
    ('squalane','squalane','en'), ('сквалан','squalane','ru'),
    -- snail mucin
    ('snail secretion filtrate','snail_mucin','en'), ('snail mucin','snail_mucin','en'),
    ('муцин улитки','snail_mucin','ru'), ('фильтрат улиточной слизи','snail_mucin','ru'),
    -- allantoin
    ('allantoin','allantoin','en'), ('аллантоин','allantoin','ru'),
    -- centella
    ('centella asiatica extract','centella','en'), ('centella asiatica','centella','en'),
    ('cica','centella','en'), ('madecassoside','centella','en'), ('asiaticoside','centella','en'),
    ('центелла азиатская','centella','ru'), ('центелла','centella','ru'),
    -- niacinamide
    ('niacinamide','niacinamide','en'), ('nicotinamide','niacinamide','en'),
    ('vitamin b3','niacinamide','en'), ('ниацинамид','niacinamide','ru'), ('никотинамид','niacinamide','ru'),
    -- acids
    ('salicylic acid','salicylic_acid','en'), ('bha','salicylic_acid','en'),
    ('салициловая кислота','salicylic_acid','ru'),
    ('glycolic acid','glycolic_acid','en'), ('гликолевая кислота','glycolic_acid','ru'),
    ('lactic acid','lactic_acid','en'), ('молочная кислота','lactic_acid','ru'),
    ('mandelic acid','mandelic_acid','en'), ('миндальная кислота','mandelic_acid','ru'),
    ('azelaic acid','azelaic_acid','en'), ('азелаиновая кислота','azelaic_acid','ru'),
    ('citric acid','citric_acid','en'), ('лимонная кислота','citric_acid','ru'),
    -- retinol
    ('retinol','retinol','en'), ('retinaldehyde','retinol','en'),
    ('retinyl palmitate','retinol','en'), ('retinyl retinoate','retinol','en'),
    ('ретинол','retinol','ru'), ('ретинил пальмитат','retinol','ru'),
    -- bakuchiol
    ('bakuchiol','bakuchiol','en'), ('бакучиол','bakuchiol','ru'),
    -- vitamin c
    ('ascorbic acid','vitamin_c','en'), ('l-ascorbic acid','vitamin_c','en'), ('vitamin c','vitamin_c','en'),
    ('ascorbyl glucoside','vitamin_c','en'), ('magnesium ascorbyl phosphate','vitamin_c','en'),
    ('tetrahexyldecyl ascorbate','vitamin_c','en'), ('ascorbyl tetraisopalmitate','vitamin_c','en'),
    ('витамин c','vitamin_c','mixed'), ('аскорбиновая кислота','vitamin_c','ru'),
    -- tocopherol
    ('tocopherol','tocopherol','en'), ('tocopheryl acetate','tocopherol','en'), ('vitamin e','tocopherol','en'),
    ('токоферол','tocopherol','ru'), ('витамин е','tocopherol','ru'), ('витамин e','tocopherol','mixed'),
    -- zinc pca
    ('zinc pca','zinc_pca','en'), ('zinc gluconate','zinc_pca','en'), ('цинк pca','zinc_pca','mixed'),
    -- essential oils / actives w/ oils
    ('melaleuca alternifolia leaf oil','tea_tree_oil','en'), ('tea tree oil','tea_tree_oil','en'),
    ('масло чайного дерева','tea_tree_oil','ru'),
    ('camellia sinensis leaf extract','green_tea','en'), ('green tea extract','green_tea','en'),
    ('экстракт зеленого чая','green_tea','ru'),
    -- fragrance
    ('parfum','fragrance','en'), ('fragrance','fragrance','en'), ('perfume','fragrance','en'),
    ('отдушка','fragrance','ru'), ('парфюмерная композиция','fragrance','ru'),
    ('ароматизатор','fragrance','ru'), ('ароматическая композиция','fragrance','ru'),
    ('linalool','linalool','en'), ('линалоол','linalool','ru'),
    ('limonene','limonene','en'), ('лимонен','limonene','ru'),
    -- alcohols
    ('alcohol denat','alcohol_denat','en'), ('denatured alcohol','alcohol_denat','en'),
    ('ethanol','alcohol_denat','en'), ('sd alcohol','alcohol_denat','en'),
    ('денатурированный спирт','alcohol_denat','ru'), ('спирт денатурированный','alcohol_denat','ru'),
    ('этанол','alcohol_denat','ru'),
    ('isopropyl alcohol','isopropyl_alcohol','en'), ('ipa','isopropyl_alcohol','en'),
    ('изопропиловый спирт','isopropyl_alcohol','ru'),
    -- sulfates
    ('sodium lauryl sulfate','sls','en'), ('sls','sls','en'), ('лаурилсульфат натрия','sls','ru'),
    ('sodium laureth sulfate','sles','en'), ('sles','sles','en'), ('лауретсульфат натрия','sles','ru'),
    -- parabens
    ('methylparaben','methylparaben','en'), ('propylparaben','methylparaben','en'),
    ('ethylparaben','methylparaben','en'), ('butylparaben','methylparaben','en'),
    ('метилпарабен','methylparaben','ru'), ('парабены','methylparaben','ru'),
    -- essential oils
    ('lavandula angustifolia oil','lavender_oil','en'), ('lavender oil','lavender_oil','en'),
    ('масло лаванды','lavender_oil','ru'),
    ('mentha piperita oil','peppermint_oil','en'), ('peppermint oil','peppermint_oil','en'),
    ('масло мяты перечной','peppermint_oil','ru'),
    ('eucalyptus globulus oil','eucalyptus_oil','en'), ('eucalyptus oil','eucalyptus_oil','en'),
    ('масло эвкалипта','eucalyptus_oil','ru'),
    -- comedogenic / heavy oils
    ('cocos nucifera oil','coconut_oil','en'), ('coconut oil','coconut_oil','en'),
    ('кокосовое масло','coconut_oil','ru'),
    ('isopropyl myristate','isopropyl_myristate','en'), ('изопропилмиристат','isopropyl_myristate','ru'),
    ('butyrospermum parkii butter','shea_butter','en'), ('shea butter','shea_butter','en'),
    ('масло ши','shea_butter','ru'),
    ('petrolatum','petrolatum','en'), ('petroleum jelly','petrolatum','en'), ('вазелин','petrolatum','ru'),
    ('mineral oil','mineral_oil','en'), ('paraffinum liquidum','mineral_oil','en'),
    ('минеральное масло','mineral_oil','ru'),
    -- uv filters
    ('zinc oxide','zinc_oxide','en'), ('оксид цинка','zinc_oxide','ru'),
    ('titanium dioxide','titanium_dioxide','en'), ('диоксид титана','titanium_dioxide','ru'),
    ('ethylhexyl methoxycinnamate','octinoxate','en'), ('octinoxate','octinoxate','en'),
    ('октиноксат','octinoxate','ru'),
    ('butyl methoxydibenzoylmethane','avobenzone','en'), ('avobenzone','avobenzone','en'),
    ('авобензон','avobenzone','ru'),
    -- junk / non-ingredient markers
    ('и др','junk','ru'), ('и другие','junk','ru'), ('др','junk','ru'),
    ('прочие компоненты','junk','ru'), ('состав','junk','ru'), ('ingredients','junk','en'),
    ('и т д','junk','ru')
  ) AS v(a, cid, lang)
) s
WHERE s.n IS NOT NULL
ON CONFLICT (alias_norm) DO NOTHING;

-- =============================================================================
-- РАСШИРЕНИЕ ПОКРЫТИЯ v2 — топ нераспознанных ингредиентов из 33_audit.
--
-- Это функциональные эксципиенты (консерванты, ПАВ, эмульгаторы, гликоли-
-- увлажнители, силиконы, хелаторы, загустители, жирные спирты), отдушечные
-- аллергены, красители CI и активы краски для волос. Семантика консервативная:
-- если эффект на кожу неизвестен / нейтрален — оставляем neutral (никаких
-- benefits/cautions, флаги пустые). Никаких медицинских заявлений.
--
-- Семейства (номера срезаются в dm.norm_ingredient_alias, поэтому
-- polyquaternium-7 / ceteareth-20 / laureth-4 / polysorbate 20 схлопываются
-- автоматически): polyquaternium, ceteareth, laureth, polysorbate.
-- =============================================================================

-- 1b. Canonical (v2)
INSERT INTO dm.ingredients_canonical (canonical_id, inci_name, display_ru, display_en, is_junk) VALUES
  ('colorant_ci',                  'CI',                          'Краситель (CI)',          'Colorant (CI)',                false),
  ('phenoxyethanol',               'Phenoxyethanol',              'Феноксиэтанол',           'Phenoxyethanol',               false),
  ('cetearyl_alcohol',             'Cetearyl Alcohol',            'Цетеариловый спирт',      'Cetearyl Alcohol',             false),
  ('propylene_glycol',             'Propylene Glycol',            'Пропиленгликоль',         'Propylene Glycol',             false),
  ('polyquaternium',               'Polyquaternium',              'Поликватерниум',          'Polyquaternium',               false),
  ('disodium_edta',                'Disodium EDTA',               'Динатрия ЭДТА',           'Disodium EDTA',                false),
  ('ethylhexylglycerin',           'Ethylhexylglycerin',          'Этилгексилглицерин',      'Ethylhexylglycerin',           false),
  ('ceteareth',                    'Ceteareth',                   'Цетеарет',                'Ceteareth',                    false),
  ('sodium_benzoate',              'Sodium Benzoate',             'Бензоат натрия',          'Sodium Benzoate',              false),
  ('cocamidopropyl_betaine',       'Cocamidopropyl Betaine',      'Кокамидопропилбетаин',    'Cocamidopropyl Betaine',       false),
  ('butylene_glycol',              'Butylene Glycol',             'Бутиленгликоль',          'Butylene Glycol',              false),
  ('dimethicone',                  'Dimethicone',                 'Диметикон',               'Dimethicone',                  false),
  ('sodium_chloride',              'Sodium Chloride',             'Хлорид натрия',           'Sodium Chloride',              false),
  ('cetrimonium_chloride',         'Cetrimonium Chloride',        'Цетримония хлорид',       'Cetrimonium Chloride',         false),
  ('hexanediol',                   'Hexanediol',                  'Гександиол',              'Hexanediol',                   false),
  ('potassium_sorbate',            'Potassium Sorbate',           'Сорбат калия',            'Potassium Sorbate',            false),
  ('hexyl_cinnamal',               'Hexyl Cinnamal',              'Гексилциннамаль',         'Hexyl Cinnamal',               false),
  ('benzyl_alcohol',               'Benzyl Alcohol',              'Бензиловый спирт',        'Benzyl Alcohol',               false),
  ('peg_castor_oil',               'PEG Hydrogenated Castor Oil', 'ПЭГ касторовое масло',    'PEG Hydrogenated Castor Oil',  false),
  ('glyceryl_stearate',            'Glyceryl Stearate',           'Глицерил стеарат',        'Glyceryl Stearate',            false),
  ('laureth',                      'Laureth',                     'Лаурет',                  'Laureth',                      false),
  ('tetrasodium_edta',             'Tetrasodium EDTA',            'Тетранатрия ЭДТА',        'Tetrasodium EDTA',             false),
  ('citronellol',                  'Citronellol',                 'Цитронеллол',             'Citronellol',                  false),
  ('xanthan_gum',                  'Xanthan Gum',                 'Ксантановая камедь',      'Xanthan Gum',                  false),
  ('caprylic_capric_triglyceride', 'Caprylic/Capric Triglyceride','Каприловый триглицерид',  'Caprylic/Capric Triglyceride', false),
  ('sodium_sulfite',               'Sodium Sulfite',              'Сульфит натрия',          'Sodium Sulfite',               false),
  ('hydrolyzed_keratin',           'Hydrolyzed Keratin',          'Гидролизованный кератин', 'Hydrolyzed Keratin',           false),
  ('caprylyl_glycol',              'Caprylyl Glycol',             'Каприлилгликоль',         'Caprylyl Glycol',              false),
  ('ammonium_hydroxide',           'Ammonium Hydroxide',          'Гидроксид аммония',       'Ammonium Hydroxide',           false),
  ('m_aminophenol',                'm-Aminophenol',               'м-Аминофенол',            'm-Aminophenol',                false),
  ('methylisothiazolinone',        'Methylisothiazolinone',       'Метилизотиазолинон',      'Methylisothiazolinone',        false),
  ('arginine',                     'Arginine',                    'Аргинин',                 'Arginine',                     false),
  ('polysorbate',                  'Polysorbate',                 'Полисорбат',              'Polysorbate',                  false),
  ('methylchloroisothiazolinone',  'Methylchloroisothiazolinone', 'Метилхлоризотиазолинон',  'Methylchloroisothiazolinone',  false),
  ('carbomer',                     'Carbomer',                    'Карбомер',                'Carbomer',                     false),
  ('stearic_acid',                 'Stearic Acid',                'Стеариновая кислота',     'Stearic Acid',                 false),
  ('resorcinol',                   'Resorcinol',                  'Резорцин',                'Resorcinol',                   false)
ON CONFLICT (canonical_id) DO UPDATE SET
  inci_name  = EXCLUDED.inci_name,
  display_ru = EXCLUDED.display_ru,
  display_en = EXCLUDED.display_en,
  is_junk    = EXCLUDED.is_junk;

-- 2b. Properties (v2). comedo 0..5 · irr 0..3 · allerg 0..3 — seed-эвристики.
-- ВАЖНО: жирные спирты (cetearyl/cetyl/stearyl) — это emollient, НЕ alcohol_drying
-- (тег не ставим, иначе ложный has_drying_alcohol на половине каталога).
-- stearic_acid — жирная кислота (emollient), НЕ кислота-эксфолиант (без exfoliant-тега).
INSERT INTO dm.ingredient_properties
  (canonical_id, functions, tags, benefits_for, cautions_for, flags_avoided,
   comedogenicity, irritancy, allergenicity, pregnancy_caution) VALUES
  ('colorant_ci',                  '{colorant}',                  '{}',          '{}','{}','{}',           0,0,1,false),
  ('phenoxyethanol',               '{preservative}',              '{}',          '{}','{}','{}',           0,1,1,false),
  ('cetearyl_alcohol',             '{emollient,emulsifier}',      '{}',          '{}','{}','{}',           1,0,0,false),
  ('propylene_glycol',             '{humectant,solvent}',         '{humectant}', '{}','{}','{}',           0,1,1,false),
  ('polyquaternium',               '{conditioning}',              '{}',          '{}','{}','{}',           0,0,0,false),
  ('disodium_edta',                '{chelator}',                  '{}',          '{}','{}','{}',           0,0,0,false),
  ('ethylhexylglycerin',           '{preservative,humectant}',    '{}',          '{}','{}','{}',           0,0,0,false),
  ('ceteareth',                    '{emulsifier,surfactant}',     '{}',          '{}','{}','{}',           1,0,0,false),
  ('sodium_benzoate',              '{preservative}',              '{}',          '{}','{}','{}',           0,0,1,false),
  ('cocamidopropyl_betaine',       '{surfactant}',                '{}',          '{}','{}','{}',           0,1,1,false),
  ('butylene_glycol',              '{humectant,solvent}',         '{humectant}', '{}','{}','{}',           0,0,0,false),
  ('dimethicone',                  '{emollient,occlusive,silicone}','{occlusive}','{}','{}','{}',          1,0,0,false),
  ('sodium_chloride',              '{thickener}',                 '{}',          '{}','{}','{}',           0,0,0,false),
  ('cetrimonium_chloride',         '{conditioning,surfactant}',   '{}',          '{}','{}','{}',           0,1,1,false),
  ('hexanediol',                   '{preservative,solvent,humectant}','{}',      '{}','{}','{}',           0,0,0,false),
  ('potassium_sorbate',            '{preservative}',              '{}',          '{}','{}','{}',           0,0,1,false),
  ('hexyl_cinnamal',               '{fragrance}',                 '{fragrance}', '{}','{}','{fragrance}',  0,1,3,false),
  ('benzyl_alcohol',               '{preservative,solvent}',      '{}',          '{}','{}','{}',           0,1,2,false),
  ('peg_castor_oil',               '{emulsifier,surfactant}',     '{}',          '{}','{}','{}',           1,0,0,false),
  ('glyceryl_stearate',            '{emollient,emulsifier}',      '{}',          '{}','{}','{}',           1,0,0,false),
  ('laureth',                      '{surfactant,emulsifier}',     '{}',          '{}','{}','{}',           0,1,0,false),
  ('tetrasodium_edta',             '{chelator}',                  '{}',          '{}','{}','{}',           0,0,0,false),
  ('citronellol',                  '{fragrance}',                 '{fragrance}', '{}','{}','{fragrance}',  0,1,3,false),
  ('xanthan_gum',                  '{thickener}',                 '{}',          '{}','{}','{}',           0,0,0,false),
  ('caprylic_capric_triglyceride', '{emollient}',                 '{}',          '{}','{}','{}',           1,0,0,false),
  ('sodium_sulfite',               '{antioxidant,preservative}',  '{}',          '{}','{}','{}',           0,1,1,false),
  ('hydrolyzed_keratin',           '{conditioning}',              '{}',          '{}','{}','{}',           0,0,1,false),
  ('caprylyl_glycol',              '{humectant,preservative}',    '{humectant}', '{}','{}','{}',           0,0,0,false),
  ('ammonium_hydroxide',           '{ph_adjuster}',               '{}',          '{}','{}','{}',           0,2,1,false),
  ('m_aminophenol',                '{hair_dye}',                  '{}',          '{}','{}','{}',           0,2,3,false),
  ('methylisothiazolinone',        '{preservative}',              '{}',          '{}','{}','{}',           0,2,3,false),
  ('arginine',                     '{ph_adjuster,humectant}',     '{humectant}', '{}','{}','{}',           0,0,0,false),
  ('polysorbate',                  '{emulsifier,surfactant}',     '{}',          '{}','{}','{}',           0,0,0,false),
  ('methylchloroisothiazolinone',  '{preservative}',              '{}',          '{}','{}','{}',           0,2,3,false),
  ('carbomer',                     '{thickener}',                 '{}',          '{}','{}','{}',           0,0,0,false),
  ('stearic_acid',                 '{emollient,emulsifier}',      '{}',          '{}','{}','{}',           2,0,0,false),
  ('resorcinol',                   '{hair_dye}',                  '{}',          '{}','{}','{}',           0,2,3,false)
ON CONFLICT (canonical_id) DO UPDATE SET
  functions         = EXCLUDED.functions,
  tags              = EXCLUDED.tags,
  benefits_for      = EXCLUDED.benefits_for,
  cautions_for      = EXCLUDED.cautions_for,
  flags_avoided     = EXCLUDED.flags_avoided,
  comedogenicity    = EXCLUDED.comedogenicity,
  irritancy         = EXCLUDED.irritancy,
  allergenicity     = EXCLUDED.allergenicity,
  pregnancy_caution = EXCLUDED.pregnancy_caution;

-- 3b. Aliases (v2) — RU/EN + варианты + расширения water/fragrance.
INSERT INTO dm.ingredient_aliases (alias_norm, canonical_id, lang, source)
SELECT n, cid, lang, 'seed'
FROM (
  SELECT dm.norm_ingredient_alias(a) AS n, cid, lang
  FROM (VALUES
    -- colorant CI (после нормализации «CI 77491» → «ci»)
    ('ci','colorant_ci','en'), ('color index','colorant_ci','en'),
    ('краситель','colorant_ci','ru'), ('пигмент','colorant_ci','ru'),
    -- preservatives
    ('phenoxyethanol','phenoxyethanol','en'), ('феноксиэтанол','phenoxyethanol','ru'),
    ('sodium benzoate','sodium_benzoate','en'), ('бензоат натрия','sodium_benzoate','ru'),
    ('potassium sorbate','potassium_sorbate','en'), ('сорбат калия','potassium_sorbate','ru'),
    ('ethylhexylglycerin','ethylhexylglycerin','en'), ('этилгексилглицерин','ethylhexylglycerin','ru'),
    ('benzyl alcohol','benzyl_alcohol','en'), ('бензиловый спирт','benzyl_alcohol','ru'),
    ('methylisothiazolinone','methylisothiazolinone','en'), ('метилизотиазолинон','methylisothiazolinone','ru'),
    ('methylchloroisothiazolinone','methylchloroisothiazolinone','en'), ('метилхлоризотиазолинон','methylchloroisothiazolinone','ru'),
    -- fatty alcohols (emollient — НЕ drying)
    ('cetearyl alcohol','cetearyl_alcohol','en'), ('cetyl alcohol','cetearyl_alcohol','en'),
    ('stearyl alcohol','cetearyl_alcohol','en'), ('цетеариловый спирт','cetearyl_alcohol','ru'),
    ('цетиловый спирт','cetearyl_alcohol','ru'), ('стеариловый спирт','cetearyl_alcohol','ru'),
    -- glycols (humectant/solvent)
    ('propylene glycol','propylene_glycol','en'), ('пропиленгликоль','propylene_glycol','ru'),
    ('butylene glycol','butylene_glycol','en'), ('бутиленгликоль','butylene_glycol','ru'),
    ('hexanediol','hexanediol','en'), ('гександиол','hexanediol','ru'),
    ('caprylyl glycol','caprylyl_glycol','en'), ('каприлилгликоль','caprylyl_glycol','ru'),
    -- silicones
    ('dimethicone','dimethicone','en'), ('диметикон','dimethicone','ru'),
    ('cyclopentasiloxane','dimethicone','en'), ('cyclomethicone','dimethicone','en'),
    ('циклопентасилоксан','dimethicone','ru'),
    -- chelators
    ('disodium edta','disodium_edta','en'), ('edta','disodium_edta','en'), ('эдта','disodium_edta','ru'),
    ('динатрия эдта','disodium_edta','ru'),
    ('tetrasodium edta','tetrasodium_edta','en'), ('тетранатрия эдта','tetrasodium_edta','ru'),
    -- thickeners
    ('xanthan gum','xanthan_gum','en'), ('ксантановая камедь','xanthan_gum','ru'), ('ксантан','xanthan_gum','ru'),
    ('carbomer','carbomer','en'), ('карбомер','carbomer','ru'),
    ('sodium chloride','sodium_chloride','en'), ('хлорид натрия','sodium_chloride','ru'), ('соль','sodium_chloride','ru'),
    -- surfactants / emulsifiers (+ семейства)
    ('cocamidopropyl betaine','cocamidopropyl_betaine','en'), ('кокамидопропилбетаин','cocamidopropyl_betaine','ru'),
    ('cetrimonium chloride','cetrimonium_chloride','en'), ('цетримония хлорид','cetrimonium_chloride','ru'),
    ('glyceryl stearate','glyceryl_stearate','en'), ('глицерил стеарат','glyceryl_stearate','ru'),
    ('peg hydrogenated castor oil','peg_castor_oil','en'), ('hydrogenated castor oil','peg_castor_oil','en'),
    ('пэг касторовое масло','peg_castor_oil','ru'),
    ('stearic acid','stearic_acid','en'), ('стеариновая кислота','stearic_acid','ru'),
    ('polyquaternium','polyquaternium','en'), ('поликватерниум','polyquaternium','ru'),
    ('ceteareth','ceteareth','en'), ('цетеарет','ceteareth','ru'),
    ('laureth','laureth','en'), ('лаурет','laureth','ru'),
    ('polysorbate','polysorbate','en'), ('полисорбат','polysorbate','ru'),
    -- emollient esters
    ('caprylic capric triglyceride','caprylic_capric_triglyceride','en'),
    ('caprylic','caprylic_capric_triglyceride','en'),
    ('capric triglyceride','caprylic_capric_triglyceride','en'),
    ('каприловый каприновый триглицерид','caprylic_capric_triglyceride','ru'),
    ('каприловый триглицерид','caprylic_capric_triglyceride','ru'),
    -- fragrance allergens (отдельная каноника, флаг fragrance)
    ('hexyl cinnamal','hexyl_cinnamal','en'), ('гексилциннамаль','hexyl_cinnamal','ru'),
    ('citronellol','citronellol','en'), ('цитронеллол','citronellol','ru'),
    -- conditioning / proteins
    ('hydrolyzed keratin','hydrolyzed_keratin','en'), ('гидролизованный кератин','hydrolyzed_keratin','ru'),
    ('кератин','hydrolyzed_keratin','ru'),
    ('arginine','arginine','en'), ('аргинин','arginine','ru'),
    -- hair dye actives / oxidisers (раздражители/аллергены — без benefits)
    ('ammonium hydroxide','ammonium_hydroxide','en'), ('гидроксид аммония','ammonium_hydroxide','ru'),
    ('аммиак','ammonium_hydroxide','ru'),
    ('m aminophenol','m_aminophenol','en'), ('p aminophenol','m_aminophenol','en'),
    ('aminophenol','m_aminophenol','en'), ('аминофенол','m_aminophenol','ru'),
    ('resorcinol','resorcinol','en'), ('резорцин','resorcinol','ru'),
    ('sodium sulfite','sodium_sulfite','en'), ('сульфит натрия','sodium_sulfite','ru'),
    -- water (расширение синонимов)
    ('distilled water','water','en'), ('deionized water','water','en'), ('di water','water','en'),
    ('очищенная вода','water','ru'), ('морская вода','water','ru'), ('вода морская','water','ru'),
    ('sea water','water','en'), ('aqua marina','water','en'), ('maris aqua','water','en'),
    ('термальная вода','water','ru'), ('thermal water','water','en'), ('aqua eau','water','en'),
    -- fragrance (расширение синонимов)
    ('parfum fragrance','fragrance','en'), ('fragrance parfum','fragrance','en'),
    ('парфюмерная отдушка','fragrance','ru'), ('отдушка парфюмерная','fragrance','ru'),
    ('parfum отдушка','fragrance','mixed'), ('parfume','fragrance','en'),
    ('парфюм ароматизатор','fragrance','ru'), ('парфюм','fragrance','ru'), ('aroma','fragrance','en')
  ) AS v(a, cid, lang)
) s
WHERE s.n IS NOT NULL
ON CONFLICT (alias_norm) DO NOTHING;

-- =============================================================================
-- РАСШИРЕНИЕ ПОКРЫТИЯ v3 — третья итерация (цель recognized_ratio_micro > 0.50).
--
-- Группы: отдушечные аллергены, химия краски для волос, гликоли-увлажнители,
-- протеины/аминокислоты, масла-эмоленты, загустители/плёнкообразователи,
-- ПАВ/эмульгаторы, pH-корректоры, силикон (amodimethicone).
--
-- ПРИМ.: benefits_for/cautions_for здесь используют расширенный словарь
-- ('dryness','dehydration','damaged_hair','sensitive') — это документирование
-- намерения. Текущий dm.product_ingredient_features эти поля НЕ читает (берёт
-- только tags/flags_avoided/comedo/irr/allerg), а движок на не-enum значениях
-- просто не срабатывает (inert). Никаких медицинских заявлений.
--
-- shea butter уже есть как canonical 'shea_butter' → ниже только новые алиасы.
-- =============================================================================

-- 1c. Canonical (v3)
INSERT INTO dm.ingredients_canonical (canonical_id, inci_name, display_ru, display_en, is_junk) VALUES
  ('benzyl_salicylate',                 'Benzyl Salicylate',                 'Бензилсалицилат',        'Benzyl Salicylate',                 false),
  ('geraniol',                          'Geraniol',                          'Гераниол',               'Geraniol',                          false),
  ('alpha_isomethyl_ionone',            'Alpha-Isomethyl Ionone',            'Альфа-изометил ионон',   'Alpha-Isomethyl Ionone',            false),
  ('coumarin',                          'Coumarin',                          'Кумарин',                'Coumarin',                          false),
  ('citral',                            'Citral',                            'Цитраль',                'Citral',                            false),
  ('toluene',                           'Toluene',                           'Толуол',                 'Toluene',                           false),
  ('sodium_hydrosulfite',              'Sodium Hydrosulfite',                'Гидросульфит натрия',    'Sodium Hydrosulfite',               false),
  ('diamine_sulfate',                   'Diamine Sulfate',                   'Диамин сульфат',         'Diamine Sulfate',                   false),
  ('methylresorcinol',                  'Methylresorcinol',                  'Метилрезорцин',          'Methylresorcinol',                  false),
  ('amino_hydroxytoluene',             'Amino Hydroxytoluene',               'Аминогидрокситолуол',    'Amino Hydroxytoluene',              false),
  ('p_phenylenediamine',                'p-Phenylenediamine',                'Парафенилендиамин',      'p-Phenylenediamine',                false),
  ('ethanolamine',                      'Ethanolamine',                      'Этаноламин',             'Ethanolamine',                      false),
  ('sodium_erythorbate',                'Sodium Erythorbate',                'Эриторбат натрия',       'Sodium Erythorbate',                false),
  ('bht',                               'BHT',                               'Бутилгидрокситолуол',    'BHT',                               false),
  ('propanediol',                       'Propanediol',                       'Пропандиол',             'Propanediol',                       false),
  ('pentylene_glycol',                  'Pentylene Glycol',                  'Пентиленгликоль',        'Pentylene Glycol',                  false),
  ('dipropylene_glycol',                'Dipropylene Glycol',                'Дипропиленгликоль',      'Dipropylene Glycol',                false),
  ('sorbitol',                          'Sorbitol',                          'Сорбитол',               'Sorbitol',                          false),
  ('hydrolyzed_wheat_protein',          'Hydrolyzed Wheat Protein',          'Гидролизат пшеничного белка','Hydrolyzed Wheat Protein',       false),
  ('hydrolyzed_collagen',               'Hydrolyzed Collagen',               'Гидролизованный коллаген','Hydrolyzed Collagen',              false),
  ('serine',                            'Serine',                            'Серин',                  'Serine',                            false),
  ('glycine',                           'Glycine',                           'Глицин',                 'Glycine',                           false),
  ('threonine',                         'Threonine',                         'Треонин',                'Threonine',                         false),
  ('proline',                           'Proline',                           'Пролин',                 'Proline',                           false),
  ('argan_oil',                         'Argania Spinosa Kernel Oil',        'Аргановое масло',        'Argan Oil',                         false),
  ('hydroxyethylcellulose',             'Hydroxyethylcellulose',             'Гидроксиэтилцеллюлоза',  'Hydroxyethylcellulose',             false),
  ('acrylates',                         'Acrylates Copolymer',               'Акрилаты',               'Acrylates Copolymer',               false),
  ('silica',                            'Silica',                            'Диоксид кремния',        'Silica',                            false),
  ('mica',                              'Mica',                              'Слюда',                  'Mica',                              false),
  ('guar_hydroxypropyltrimonium_chloride','Guar Hydroxypropyltrimonium Chloride','Гуар гидроксипропилтримония хлорид','Guar Hydroxypropyltrimonium Chloride',false),
  ('trideceth',                         'Trideceth',                         'Тридецет',               'Trideceth',                         false),
  ('cocamide_mea',                      'Cocamide MEA',                      'Кокамид МЕА',            'Cocamide MEA',                      false),
  ('cocamide_dea',                      'Cocamide DEA',                      'Кокамид ДЕА',            'Cocamide DEA',                      false),
  ('peg',                               'PEG',                               'ПЭГ',                    'PEG',                               false),
  ('peg_stearate',                      'PEG Stearate',                      'ПЭГ стеарат',            'PEG Stearate',                      false),
  ('behentrimonium_chloride',           'Behentrimonium Chloride',           'Бегентримония хлорид',   'Behentrimonium Chloride',           false),
  ('sodium_hydroxide',                  'Sodium Hydroxide',                  'Гидроксид натрия',       'Sodium Hydroxide',                  false),
  ('triethanolamine',                   'Triethanolamine',                   'Триэтаноламин',          'Triethanolamine',                   false),
  ('amodimethicone',                    'Amodimethicone',                    'Амодиметикон',           'Amodimethicone',                    false)
ON CONFLICT (canonical_id) DO UPDATE SET
  inci_name  = EXCLUDED.inci_name,
  display_ru = EXCLUDED.display_ru,
  display_en = EXCLUDED.display_en,
  is_junk    = EXCLUDED.is_junk;

-- 2c. Properties (v3)
INSERT INTO dm.ingredient_properties
  (canonical_id, functions, tags, benefits_for, cautions_for, flags_avoided,
   comedogenicity, irritancy, allergenicity, pregnancy_caution) VALUES
  -- отдушечные аллергены
  ('benzyl_salicylate',      '{fragrance}',                 '{fragrance,allergen}', '{}',                    '{}',          '{fragrance}', 0,1,2,false),
  ('geraniol',               '{fragrance}',                 '{fragrance,allergen}', '{}',                    '{}',          '{fragrance}', 0,1,2,false),
  ('alpha_isomethyl_ionone', '{fragrance}',                 '{fragrance,allergen}', '{}',                    '{}',          '{fragrance}', 0,1,2,false),
  ('coumarin',               '{fragrance}',                 '{fragrance,allergen}', '{}',                    '{}',          '{fragrance}', 0,1,2,false),
  ('citral',                 '{fragrance}',                 '{fragrance,allergen}', '{}',                    '{}',          '{fragrance}', 0,1,2,false),
  -- химия краски для волос (осторожная шкала; cautions=sensitive)
  ('toluene',                '{solvent}',                   '{color_chemistry}',    '{}',                    '{sensitive}', '{}',          0,2,1,true),
  ('sodium_hydrosulfite',    '{color_chemistry}',           '{color_chemistry}',    '{}',                    '{sensitive}', '{}',          0,2,1,false),
  ('diamine_sulfate',        '{hair_dye}',                  '{hair_dye}',           '{}',                    '{sensitive}', '{}',          0,2,3,false),
  ('methylresorcinol',       '{hair_dye}',                  '{hair_dye}',           '{}',                    '{sensitive}', '{}',          0,2,2,false),
  ('amino_hydroxytoluene',   '{hair_dye}',                  '{hair_dye}',           '{}',                    '{sensitive}', '{}',          0,2,2,false),
  ('p_phenylenediamine',     '{hair_dye}',                  '{hair_dye}',           '{}',                    '{sensitive}', '{}',          0,2,3,false),
  ('ethanolamine',           '{ph_adjuster}',               '{color_chemistry}',    '{}',                    '{sensitive}', '{}',          0,2,1,false),
  ('sodium_erythorbate',     '{antioxidant}',               '{color_chemistry}',    '{}',                    '{}',          '{}',          0,0,0,false),
  ('bht',                    '{antioxidant,preservative}',  '{antioxidant}',        '{}',                    '{}',          '{}',          1,0,1,false),
  -- увлажнители / растворители
  ('propanediol',            '{humectant,solvent}',         '{humectant}',          '{dryness,dehydration}', '{}',          '{}',          0,0,0,false),
  ('pentylene_glycol',       '{humectant,solvent,preservative}','{humectant}',      '{dryness,dehydration}', '{}',          '{}',          0,0,0,false),
  ('dipropylene_glycol',     '{humectant,solvent}',         '{humectant}',          '{dryness,dehydration}', '{}',          '{}',          0,0,0,false),
  ('sorbitol',               '{humectant}',                 '{humectant}',          '{dryness,dehydration}', '{}',          '{}',          0,0,0,false),
  -- протеины / аминокислоты
  ('hydrolyzed_wheat_protein','{conditioning,hair_repair}', '{}',                   '{damaged_hair,dryness}','{}',          '{}',          0,0,1,false),
  ('hydrolyzed_collagen',    '{conditioning,hair_repair}',  '{}',                   '{damaged_hair,dryness}','{}',          '{}',          0,0,0,false),
  ('serine',                 '{humectant,conditioning}',    '{humectant}',          '{dryness}',             '{}',          '{}',          0,0,0,false),
  ('glycine',                '{humectant,conditioning}',    '{humectant}',          '{dryness}',             '{}',          '{}',          0,0,0,false),
  ('threonine',              '{humectant,conditioning}',    '{humectant}',          '{dryness}',             '{}',          '{}',          0,0,0,false),
  ('proline',                '{humectant,conditioning}',    '{humectant}',          '{dryness}',             '{}',          '{}',          0,0,0,false),
  -- масла-эмоленты
  ('argan_oil',              '{emollient,occlusive}',       '{}',                   '{dryness}',             '{}',          '{}',          1,0,0,false),
  -- загустители / плёнкообразователи / текстура
  ('hydroxyethylcellulose',  '{thickener}',                 '{}',                   '{}',                    '{}',          '{}',          0,0,0,false),
  ('acrylates',              '{film_former}',               '{}',                   '{}',                    '{}',          '{}',          0,0,0,false),
  ('silica',                 '{texture,absorbent}',         '{}',                   '{}',                    '{}',          '{}',          0,0,0,false),
  ('mica',                   '{colorant,texture}',          '{}',                   '{}',                    '{}',          '{}',          0,0,0,false),
  ('guar_hydroxypropyltrimonium_chloride','{conditioning,thickener}','{}',          '{}',                    '{}',          '{}',          0,0,0,false),
  -- ПАВ / эмульгаторы
  ('trideceth',              '{surfactant,emulsifier}',     '{}',                   '{}',                    '{}',          '{}',          0,1,0,false),
  ('cocamide_mea',           '{surfactant}',                '{}',                   '{}',                    '{}',          '{}',          0,1,1,false),
  ('cocamide_dea',           '{surfactant}',                '{}',                   '{}',                    '{}',          '{}',          0,2,1,false),
  ('peg',                    '{humectant,solvent,emulsifier}','{}',                 '{}',                    '{}',          '{}',          0,0,0,false),
  ('peg_stearate',           '{emulsifier,surfactant}',     '{}',                   '{}',                    '{}',          '{}',          1,0,0,false),
  ('behentrimonium_chloride','{conditioning,surfactant}',   '{}',                   '{}',                    '{}',          '{}',          0,1,1,false),
  -- pH-корректоры
  ('sodium_hydroxide',       '{ph_adjuster}',               '{}',                   '{}',                    '{sensitive}', '{}',          0,2,0,false),
  ('triethanolamine',        '{ph_adjuster,emulsifier}',    '{}',                   '{}',                    '{sensitive}', '{}',          0,1,1,false),
  -- силикон
  ('amodimethicone',         '{emollient,conditioning,silicone}','{}',              '{}',                    '{}',          '{}',          1,0,0,false)
ON CONFLICT (canonical_id) DO UPDATE SET
  functions         = EXCLUDED.functions,
  tags              = EXCLUDED.tags,
  benefits_for      = EXCLUDED.benefits_for,
  cautions_for      = EXCLUDED.cautions_for,
  flags_avoided     = EXCLUDED.flags_avoided,
  comedogenicity    = EXCLUDED.comedogenicity,
  irritancy         = EXCLUDED.irritancy,
  allergenicity     = EXCLUDED.allergenicity,
  pregnancy_caution = EXCLUDED.pregnancy_caution;

-- 3c. Aliases (v3)
INSERT INTO dm.ingredient_aliases (alias_norm, canonical_id, lang, source)
SELECT n, cid, lang, 'seed'
FROM (
  SELECT dm.norm_ingredient_alias(a) AS n, cid, lang
  FROM (VALUES
    -- fragrance allergens
    ('benzyl salicylate','benzyl_salicylate','en'), ('бензилсалицилат','benzyl_salicylate','ru'),
    ('бензил салицилат','benzyl_salicylate','ru'),
    ('geraniol','geraniol','en'), ('гераниол','geraniol','ru'),
    ('alpha isomethyl ionone','alpha_isomethyl_ionone','en'), ('isomethyl ionone','alpha_isomethyl_ionone','en'),
    ('альфа изометил ионон','alpha_isomethyl_ionone','ru'),
    ('coumarin','coumarin','en'), ('кумарин','coumarin','ru'),
    ('citral','citral','en'), ('цитраль','citral','ru'),
    -- hair dye / color chemistry
    ('toluene','toluene','en'), ('толуол','toluene','ru'),
    ('sodium hydrosulfite','sodium_hydrosulfite','en'), ('sodium dithionite','sodium_hydrosulfite','en'),
    ('гидросульфит натрия','sodium_hydrosulfite','ru'),
    ('diamine sulfate','diamine_sulfate','en'), ('toluene diamine','diamine_sulfate','en'),
    ('toluene diamine sulfate','diamine_sulfate','en'), ('диамин сульфат','diamine_sulfate','ru'),
    ('methylresorcinol','methylresorcinol','en'), ('метилрезорцин','methylresorcinol','ru'),
    ('amino hydroxytoluene','amino_hydroxytoluene','en'), ('аминогидрокситолуол','amino_hydroxytoluene','ru'),
    ('p phenylenediamine','p_phenylenediamine','en'), ('phenylenediamine','p_phenylenediamine','en'),
    ('ppd','p_phenylenediamine','en'), ('парафенилендиамин','p_phenylenediamine','ru'),
    ('ethanolamine','ethanolamine','en'), ('этаноламин','ethanolamine','ru'),
    ('sodium erythorbate','sodium_erythorbate','en'), ('эриторбат натрия','sodium_erythorbate','ru'),
    ('bht','bht','en'), ('butylated hydroxytoluene','bht','en'), ('бутилгидрокситолуол','bht','ru'),
    -- humectants / solvents
    ('propanediol','propanediol','en'), ('пропандиол','propanediol','ru'),
    ('pentylene glycol','pentylene_glycol','en'), ('пентиленгликоль','pentylene_glycol','ru'),
    ('dipropylene glycol','dipropylene_glycol','en'), ('дипропиленгликоль','dipropylene_glycol','ru'),
    ('sorbitol','sorbitol','en'), ('сорбитол','sorbitol','ru'),
    -- proteins / amino acids
    ('hydrolyzed wheat protein','hydrolyzed_wheat_protein','en'),
    ('гидролизованный пшеничный протеин','hydrolyzed_wheat_protein','ru'),
    ('гидролизат пшеничного белка','hydrolyzed_wheat_protein','ru'),
    ('hydrolyzed collagen','hydrolyzed_collagen','en'), ('гидролизованный коллаген','hydrolyzed_collagen','ru'),
    ('коллаген','hydrolyzed_collagen','ru'),
    ('serine','serine','en'), ('серин','serine','ru'),
    ('glycine','glycine','en'), ('глицин','glycine','ru'),
    ('threonine','threonine','en'), ('треонин','threonine','ru'),
    ('proline','proline','en'), ('пролин','proline','ru'),
    -- oils / butters
    ('argania spinosa kernel oil','argan_oil','en'), ('argania spinosa oil','argan_oil','en'),
    ('argan oil','argan_oil','en'), ('масло арганы','argan_oil','ru'), ('аргановое масло','argan_oil','ru'),
    ('масло аргании','argan_oil','ru'),
    ('butyrospermum parkii shea butter','shea_butter','en'), ('butyrospermum parkii','shea_butter','en'),
    ('ши','shea_butter','ru'),
    -- thickeners / film-formers / texture
    ('hydroxyethylcellulose','hydroxyethylcellulose','en'), ('hydroxyethyl cellulose','hydroxyethylcellulose','en'),
    ('гидроксиэтилцеллюлоза','hydroxyethylcellulose','ru'),
    ('acrylates','acrylates','en'), ('acrylates copolymer','acrylates','en'),
    ('acrylates crosspolymer','acrylates','en'), ('акрилаты','acrylates','ru'),
    ('silica','silica','en'), ('диоксид кремния','silica','ru'), ('кремнезем','silica','ru'),
    ('mica','mica','en'), ('слюда','mica','ru'),
    ('guar hydroxypropyltrimonium chloride','guar_hydroxypropyltrimonium_chloride','en'),
    ('гуар гидроксипропилтримония хлорид','guar_hydroxypropyltrimonium_chloride','ru'),
    -- surfactants / emulsifiers
    ('trideceth','trideceth','en'), ('тридецет','trideceth','ru'),
    ('cocamide mea','cocamide_mea','en'), ('кокамид меа','cocamide_mea','ru'),
    ('cocamide dea','cocamide_dea','en'), ('кокамид деа','cocamide_dea','ru'),
    ('peg','peg','en'), ('пэг','peg','ru'),
    ('peg stearate','peg_stearate','en'), ('пэг стеарат','peg_stearate','ru'),
    ('behentrimonium chloride','behentrimonium_chloride','en'), ('бегентримония хлорид','behentrimonium_chloride','ru'),
    -- pH adjusters
    ('sodium hydroxide','sodium_hydroxide','en'), ('гидроксид натрия','sodium_hydroxide','ru'),
    ('каустическая сода','sodium_hydroxide','ru'),
    ('triethanolamine','triethanolamine','en'), ('триэтаноламин','triethanolamine','ru'),
    -- silicone
    ('amodimethicone','amodimethicone','en'), ('амодиметикон','amodimethicone','ru')
  ) AS v(a, cid, lang)
) s
WHERE s.n IS NOT NULL
ON CONFLICT (alias_norm) DO NOTHING;

-- ─────────────────────────── 4. Sanity ────────────────────────────────────────
DO $sanity$
DECLARE c_canon int; c_alias int; c_prop int;
BEGIN
  SELECT count(*) INTO c_canon FROM dm.ingredients_canonical;
  SELECT count(*) INTO c_alias FROM dm.ingredient_aliases;
  SELECT count(*) INTO c_prop  FROM dm.ingredient_properties;
  RAISE NOTICE 'seed: canonical=% aliases=% properties=%', c_canon, c_alias, c_prop;
  -- ключевые синонимы реально сводятся к одному canonical_id
  ASSERT (SELECT canonical_id FROM dm.ingredient_aliases WHERE alias_norm = dm.norm_ingredient_alias('Вода очищенная')) = 'water';
  ASSERT (SELECT canonical_id FROM dm.ingredient_aliases WHERE alias_norm = dm.norm_ingredient_alias('Parfum')) = 'fragrance';
  ASSERT (SELECT canonical_id FROM dm.ingredient_aliases WHERE alias_norm = dm.norm_ingredient_alias('Отдушка')) = 'fragrance';
  ASSERT (SELECT canonical_id FROM dm.ingredient_aliases WHERE alias_norm = dm.norm_ingredient_alias('Niacinamide 4%')) = 'niacinamide';
  -- v2 coverage:
  ASSERT (SELECT canonical_id FROM dm.ingredient_aliases WHERE alias_norm = dm.norm_ingredient_alias('parfum fragrance')) = 'fragrance';
  ASSERT (SELECT canonical_id FROM dm.ingredient_aliases WHERE alias_norm = dm.norm_ingredient_alias('очищенная вода')) = 'water';
  ASSERT (SELECT canonical_id FROM dm.ingredient_aliases WHERE alias_norm = dm.norm_ingredient_alias('феноксиэтанол')) = 'phenoxyethanol';
  ASSERT (SELECT canonical_id FROM dm.ingredient_aliases WHERE alias_norm = dm.norm_ingredient_alias('ci 77491')) = 'colorant_ci';
  ASSERT (SELECT canonical_id FROM dm.ingredient_aliases WHERE alias_norm = dm.norm_ingredient_alias('Cetearyl Alcohol')) = 'cetearyl_alcohol';
  -- жирный спирт НЕ помечается как сушащий (иначе ложный has_drying_alcohol):
  ASSERT NOT ('alcohol_drying' = ANY(
    (SELECT tags FROM dm.ingredient_properties WHERE canonical_id = 'cetearyl_alcohol')));
  -- v3 coverage:
  ASSERT (SELECT canonical_id FROM dm.ingredient_aliases WHERE alias_norm = dm.norm_ingredient_alias('масло ши')) = 'shea_butter';
  ASSERT (SELECT canonical_id FROM dm.ingredient_aliases WHERE alias_norm = dm.norm_ingredient_alias('benzyl salicylate')) = 'benzyl_salicylate';
  ASSERT (SELECT canonical_id FROM dm.ingredient_aliases WHERE alias_norm = dm.norm_ingredient_alias('alpha-isomethyl ionone')) = 'alpha_isomethyl_ionone';
  ASSERT (SELECT canonical_id FROM dm.ingredient_aliases WHERE alias_norm = dm.norm_ingredient_alias('p-phenylenediamine')) = 'p_phenylenediamine';
  RAISE NOTICE 'seed sanity: OK';
END
$sanity$;
