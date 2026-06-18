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
  RAISE NOTICE 'seed sanity: OK';
END
$sanity$;
