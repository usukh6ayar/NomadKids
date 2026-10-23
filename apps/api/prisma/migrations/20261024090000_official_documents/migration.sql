-- «Үндсэн баримт бичиг» — the ministry register, platform-wide (backend list №7,
-- 2026-10-23). No kindergartenId: CLAUDE.md §3.1's exception, the user 2026-10-23.
-- Additive: a new enum and a new table.

-- CreateEnum
CREATE TYPE "OfficialSourceLevel" AS ENUM ('official_pdf', 'official_full_text', 'official_repository_page', 'official_notice_only', 'official_index_only');

-- CreateTable
CREATE TABLE "official_documents" (
    "id" UUID NOT NULL,
    "code" TEXT,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "number" TEXT,
    "url" TEXT NOT NULL,
    "sourceLevel" "OfficialSourceLevel" NOT NULL,
    "reviewRequired" BOOLEAN NOT NULL DEFAULT false,
    "audience" TEXT[],
    "notes" TEXT,
    "checkedOn" DATE,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "official_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "official_documents_code_key" ON "official_documents"("code");

-- CreateIndex
CREATE INDEX "official_documents_deletedAt_featured_idx" ON "official_documents"("deletedAt", "featured");

-- AddForeignKey
ALTER TABLE "official_documents" ADD CONSTRAINT "official_documents_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed: the 37 entries the web shipped in `apps/web/lib/official-documents.ts`
-- (the register as checked on 2026-10-19), keyed by their SOB code.
INSERT INTO "official_documents"
  ("id", "code", "category", "title", "year", "number", "url", "sourceLevel",
   "reviewRequired", "audience", "notes", "checkedOn", "featured", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), 'SOB-001', 'Хууль', 'Сургуулийн өмнөх болон ерөнхий боловсролын тухай хууль', 2023, NULL, 'https://legalinfo.mn/mn/detail?lawId=16759959012931', 'official_full_text', false, ARRAY['Эрхлэгч', 'Арга зүйч', 'Багш']::TEXT[], 'СӨБ болон ЕБС-д хамрах хууль; СӨБ-ийн холбогдох зүйл, заалтыг ашиглана.', '2026-10-19'::DATE, false, NOW(), NOW()),
  (gen_random_uuid(), 'SOB-002', 'Дүрэм, журам', 'Хүүхдийн цэцэрлэгийн үлгэрчилсэн дүрэм', 2023, 'А/569', 'https://legalinfo.mn/mn/detail?lawId=17048151375571', 'official_full_text', false, ARRAY['Эрхлэгч', 'Арга зүйч', 'Багш']::TEXT[], NULL, '2026-10-19'::DATE, false, NOW(), NOW()),
  (gen_random_uuid(), 'SOB-003', 'Дүрэм, журам', 'Сургуулийн өмнөх боловсролын сургалт, үйл ажиллагаа зохион байгуулах журам', 2025, 'А/401', 'https://moe.gov.mn/post/168746', 'official_notice_only', true, ARRAY['Эрхлэгч', 'Арга зүйч', 'Багш']::TEXT[], 'Албан тайланд баталсныг дурдсан. Журмын эх хавсралтын шууд холбоосыг баталгаажуулах шаардлагатай.', '2026-10-19'::DATE, false, NOW(), NOW()),
  (gen_random_uuid(), 'SOB-004', 'Дүрэм, журам', 'Сургуулийн өмнөх боловсролын хувилбарт сургалт зохион байгуулах журам', 2022, 'А/224', 'https://legalinfo.mn/mn/detail?lawId=16530818666131', 'official_full_text', false, ARRAY['Эрхлэгч', 'Арга зүйч', 'Багш']::TEXT[], NULL, '2026-10-19'::DATE, false, NOW(), NOW()),
  (gen_random_uuid(), 'SOB-005', 'Дүрэм, журам', 'СӨБ-ын суралцагчийн хөгжил болон сургуульд бэлтгэгдсэн байдлыг үнэлэх журам', 2026, 'А/79', 'https://legalinfo.mn/mn/detail?lawId=17436334882422', 'official_full_text', false, ARRAY['Эрхлэгч', 'Арга зүйч', 'Багш']::TEXT[], '2020 оны А/280 журмыг шинэчилсэн. Журмын хавсралт болох үнэлгээний шалгуурыг албан сайтад нийтлээгүй байна (2026-10-20).', '2026-10-19'::DATE, true, NOW(), NOW()),
  (gen_random_uuid(), 'SOB-006', 'Дүрэм, журам', 'Цэцэрлэг, ерөнхий боловсролын сургуулийн зөвлөлийн үйл ажиллагааны нийтлэг журам', 2024, 'А/158', 'https://legalinfo.mn/mn/detail?lawId=17140243487881&showType=1', 'official_full_text', false, ARRAY['Эрхлэгч', 'Арга зүйч', 'Багш']::TEXT[], NULL, '2026-10-19'::DATE, false, NOW(), NOW()),
  (gen_random_uuid(), 'SOB-007', 'Сургалтын хөтөлбөр', 'Сургуулийн өмнөх боловсролын сургалтын хөтөлбөр (2025)', 2025, 'А/404', 'https://mnier.mn/api/media/file/sub2025.pdf', 'official_pdf', false, ARRAY['Эрхлэгч', 'Арга зүйч', 'Багш']::TEXT[], 'Мөрдөж буй хөтөлбөр.', '2026-10-19'::DATE, true, NOW(), NOW()),
  (gen_random_uuid(), 'SOB-037', 'Сургалтын хөтөлбөр', 'Сургуулийн өмнөх боловсролын сургалтын хөтөлбөр, хэрэгжүүлэх зөвлөмж (2019)', 2019, NULL, 'https://mnier.mn/api/media/file/sub2019.pdf', 'official_pdf', false, ARRAY['Эрхлэгч', 'Арга зүйч', 'Багш']::TEXT[], 'Өмнөх хувилбар; одоо 2025 оны хөтөлбөрийг мөрдөнө.', '2026-10-19'::DATE, false, NOW(), NOW()),
  (gen_random_uuid(), 'SOB-009', 'Сургалтын хөтөлбөр', 'Бага бүлгийн багшийн гарын авлага', 2025, NULL, 'https://mnier.mn/api/media/file/Bagshiin_gariin_avlaga_Baga_buleg_204ca4f31e.pdf', 'official_pdf', false, ARRAY['Багш', 'Арга зүйч']::TEXT[], NULL, '2026-10-19'::DATE, false, NOW(), NOW()),
  (gen_random_uuid(), 'SOB-010', 'Сургалтын хөтөлбөр', 'Дунд бүлгийн багшийн гарын авлага', 2025, NULL, 'https://mnier.mn/api/media/file/Bagshiin_gariin_avlaga_Dund_buleg_e0345ccaa5.pdf', 'official_pdf', false, ARRAY['Багш', 'Арга зүйч']::TEXT[], NULL, '2026-10-19'::DATE, false, NOW(), NOW()),
  (gen_random_uuid(), 'SOB-011', 'Сургалтын хөтөлбөр', 'Ахлах бүлгийн багшийн гарын авлага', 2025, NULL, 'https://mnier.mn/api/media/file/Sub_Ahlah_buleg_003f7bc79a.pdf', 'official_pdf', false, ARRAY['Багш', 'Арга зүйч']::TEXT[], NULL, '2026-10-19'::DATE, false, NOW(), NOW()),
  (gen_random_uuid(), 'SOB-012', 'Сургалтын хөтөлбөр', 'Бэлтгэл бүлгийн багшийн гарын авлага', 2025, NULL, 'https://mnier.mn/api/media/file/Sub_Beltgel_buleg_34fac6d91e.pdf', 'official_pdf', false, ARRAY['Багш', 'Арга зүйч']::TEXT[], NULL, '2026-10-19'::DATE, false, NOW(), NOW()),
  (gen_random_uuid(), 'SOB-008', 'Сургалтын хөтөлбөр', 'СӨБ, ЕБС-ийн сургалтын хөтөлбөрийн үзэл баримтлал (2024–2036)', 2024, 'ЗГ №176', 'https://legalinfo.mn/mn/detail?lawId=17140353213781', 'official_full_text', true, ARRAY['Эрхлэгч', 'Арга зүйч', 'Багш']::TEXT[], 'Холбоос нь зөвхөн баталсан тогтоолыг нээнэ; хавсралт болох «үзэл баримтлал»-ын эх legalinfo.mn-д алга (2026-10-20).', '2026-10-19'::DATE, false, NOW(), NOW()),
  (gen_random_uuid(), 'SOB-013', 'Дүрэм, журам', 'Цэцэрлэг, багшийн ажлын гүйцэтгэлийн үнэлгээ зохион байгуулах журам, шалгуур', 2026, 'А/27', 'https://cdn.greensoft.mn/uploads/users/2760/files/%D0%90_27.pdf', 'official_pdf', false, ARRAY['Эрхлэгч', 'Арга зүйч', 'Багш']::TEXT[], '2026.04.27 А/27 тушаал; журам/шалгуурын эх хавсралтыг тусад нь шалгана.', '2026-10-19'::DATE, false, NOW(), NOW()),
  (gen_random_uuid(), 'SOB-014', 'Дүрэм, журам', 'Цэцэрлэгийн багш, удирдах ажилтанд мэргэшлийн зэрэг олгох, хүчингүй болгох журам', 2024, 'А/95', 'https://legalinfo.mn/mn/detail?lawId=17141618951041&showType=1', 'official_full_text', true, ARRAY['Эрхлэгч', 'Арга зүйч', 'Багш']::TEXT[], 'Энэ нь тушаалын 1-р хавсралт (журам); журамд заасан маягт тусдаа хавсралт бөгөөд legalinfo.mn-д алга (2026-10-20).', '2026-10-19'::DATE, false, NOW(), NOW()),
  (gen_random_uuid(), 'SOB-015', 'Дүрэм, журам', 'СӨБ, ЕБС-ийн багш, ажилтны мэргэжлийн ёс зүйн дүрэм', 2022, 'А/545', 'https://legalinfo.mn/mn/detail?lawId=16532345574681', 'official_full_text', true, ARRAY['Эрхлэгч', 'Арга зүйч', 'Багш']::TEXT[], 'Энэ нь тушаалын 1-р хавсралт; бусад хавсралт legalinfo.mn-д алга (2026-10-20).', '2026-10-19'::DATE, false, NOW(), NOW()),
  (gen_random_uuid(), 'SOB-016', 'Дүрэм, журам', 'Цэцэрлэг, ЕБС-ийн багш, ажилтны мэргэжлийн хөгжлийн үйл ажиллагааны журам', 2025, 'А/25', 'https://moe.gov.mn/post/178023', 'official_notice_only', true, ARRAY['Эрхлэгч', 'Арга зүйч', 'Багш']::TEXT[], 'Яамны тайланд журам батлагдсаныг дурдсан; эх хавсралтыг тусад нь баталгаажуулна.', '2026-10-19'::DATE, false, NOW(), NOW()),
  (gen_random_uuid(), 'SOB-017', 'Аргачлал', 'СӨБ-ын байгууллага, ЕБС-ийн хамран сургах тойрог тогтоох аргачлал', 2024, 'А/82', 'https://legalinfo.mn/mn/detail?lawId=17089855565881&showType=1', 'official_full_text', false, ARRAY['Эрхлэгч', 'Арга зүйч', 'Багш']::TEXT[], NULL, '2026-10-19'::DATE, false, NOW(), NOW()),
  (gen_random_uuid(), 'SOB-018', 'Жагсаалт', 'СӨБ-ын хүүхдийн хичээлийн хэрэглэл, сургалтын болон эрүүл ахуйн хэрэгслийн жагсаалт', 2023, 'А/273; А/192 (2025)', 'https://www.city.edu.mn/public/br?id=453', 'official_notice_only', true, ARRAY['Эрхлэгч', 'Арга зүйч', 'Багш']::TEXT[], '2025.08.15 А/192 өөрчлөлт орсон; шинэчилсэн хавсралтын эхийг нягтлах.', '2026-10-19'::DATE, false, NOW(), NOW()),
  (gen_random_uuid(), 'SOB-019', 'Аргачлал', 'Ганцаарчилсан сургалтын төлөвлөгөө, төлөвлөгөө боловсруулах аргачлал', 2022, NULL, 'https://moe.gov.mn/post/120594', 'official_repository_page', true, ARRAY['Эрхлэгч', 'Арга зүйч', 'Багш']::TEXT[], 'Аргачлал болон загварын албан нийтлэл; тушаалын дугаарыг баталгаажуулаагүй.', '2026-10-19'::DATE, false, NOW(), NOW()),
  (gen_random_uuid(), 'SOB-020', 'Дүрэм, журам', 'Сургалтын байгууллагын хүүхдийн хоол, хүнсний хангамж, үйлчилгээ үзүүлэх журам', 2024, 'А/140', 'https://legalinfo.mn/mn/detail?lawId=17089867347501&showType=1', 'official_full_text', false, ARRAY['Эрхлэгч', 'Арга зүйч', 'Багш']::TEXT[], 'Журмын 1.1-т төрийн өмчийн цэцэрлэгийг заасан.', '2026-10-19'::DATE, false, NOW(), NOW()),
  (gen_random_uuid(), 'SOB-021', 'Норматив', 'Цэцэрлэг, сургуулийн насны хүүхдийн хоногийн хоолны илчлэгийн хуваарилалт', 2020, 'А/166, А/559, 222', 'https://legalinfo.mn/mn/detail?lawId=211418&showType=1', 'official_full_text', false, ARRAY['Эрхлэгч', 'Арга зүйч', 'Багш']::TEXT[], NULL, '2026-10-19'::DATE, false, NOW(), NOW()),
  (gen_random_uuid(), 'SOB-022', 'Тогтоол', 'Цэцэрлэгийн хүүхдийн хоолны зардлын хэмжээг шинэчлэн тогтоох тухай', 2024, 'ЗГ №237', 'https://legalinfo.mn/mn/detail?lawId=17140605192131', 'official_full_text', false, ARRAY['Эрхлэгч', 'Арга зүйч', 'Багш']::TEXT[], 'Төрийн болон орон нутгийн өмчийн цэцэрлэгийн зохицуулалт.', '2026-10-19'::DATE, false, NOW(), NOW()),
  (gen_random_uuid(), 'SOB-023', 'Тогтоол', 'СӨБ-ын хувьсах зардлын хэмжээ, итгэлцүүр, санхүүжүүлэх журам', 2026, 'ЗГ №149', 'https://legalinfo.mn/mn/detail?lawId=17141293183621', 'official_full_text', true, ARRAY['Эрхлэгч', 'Арга зүйч', 'Багш']::TEXT[], 'Анхааруулга: холбоос 2024 оны №53 тогтоол руу заадаг; 2026 оны №149 тогтоолын эх олдоогүй (2026-10-20). 2026.05.01-ээс хэрэгжүүлэхээр заасан; 2024 оны хуучин заалтуудыг бүү ашигла.', '2026-10-19'::DATE, false, NOW(), NOW()),
  (gen_random_uuid(), 'SOB-024', 'Тогтоол', 'Цэцэрлэг, ЕБС-д суурилсан урьдчилан сэргийлэх, эрт илрүүлэх үзлэг зохион байгуулах тухай', 2026, 'ЗГ №301', 'https://moe.gov.mn/%D0%B7%D0%B0%D1%81%D0%B3%D0%B8%D0%B9%D0%BD-%D0%B3%D0%B0%D0%B7%D1%80%D1%8B%D0%BD-%D1%82%D0%BE%D0%B3%D1%82%D0%BE%D0%BE%D0%BB', 'official_index_only', true, ARRAY['Эрхлэгч', 'Арга зүйч', 'Багш']::TEXT[], 'Яамны тогтоолын бүртгэл; эх тогтоол болон 2026 оны А/255/А/254 удирдамжийг тодруулна.', '2026-10-19'::DATE, false, NOW(), NOW()),
  (gen_random_uuid(), 'SOB-025', 'Бодлогын чиглэл', 'СӨБ болон ЕБС-ийн 2026–2027 оны хичээлийн жилийн зорилго, зорилт', 2026, NULL, 'https://www.gov.mn/news/n/9e40', 'official_notice_only', true, ARRAY['Эрхлэгч', 'Арга зүйч', 'Багш']::TEXT[], 'Одоогийн хичээлийн жилийн чиглэл, заавал мөрдөх хууль бус.', '2026-10-19'::DATE, false, NOW(), NOW()),
  (gen_random_uuid(), 'SOB-026', 'Стандарт', 'СӨБ-ын байгууллагын сургалтын орчин. Ерөнхий шаардлага', 2015, 'MNS 6558:2015', 'https://cdn.greensoft.mn/uploads/users/2760/files/PDF/kindergarten%20standart.pdf', 'official_pdf', false, ARRAY['Эрхлэгч', 'Арга зүйч', 'Багш']::TEXT[], 'Шинэчлэх төсөл явагдаж буй тул хамгийн сүүлийн батлагдсан эхийг шалгах.', '2026-10-19'::DATE, false, NOW(), NOW()),
  (gen_random_uuid(), 'SOB-027', 'Стандарт', 'Сургалт, хүмүүжлийн орчны эрүүл ахуйн шаардлага', 2019, 'MNS 6799:2019', 'https://cdn.greensoft.mn/uploads/users/2760/files/PDF/standart%206799.pdf', 'official_pdf', false, ARRAY['Эрхлэгч', 'Арга зүйч', 'Багш']::TEXT[], 'Яамны хүснэгтийн гарчигт MNS 6782 гэж алдаатай бичигдсэн; эх стандартыг шалгана.', '2026-10-19'::DATE, false, NOW(), NOW()),
  (gen_random_uuid(), 'SOB-028', 'Стандарт', 'ЕБС, дотуур байр, цэцэрлэгийн хоол үйлдвэрлэл, үйлчилгээнд тавих шаардлага', 2023, 'MNS 7005:2023', 'https://www.gov.mn/news/n/96c9', 'official_notice_only', true, ARRAY['Эрхлэгч', 'Арга зүйч', 'Багш']::TEXT[], 'Стандартыг бүрэн эхээр нь нийтлээгүй, эрх бүхий сувгаар үзэх шаардлагатай.', '2026-10-19'::DATE, false, NOW(), NOW()),
  (gen_random_uuid(), 'SOB-029', 'Барилгын норм', 'СӨБ-ын байгууллагын барилгын төлөвлөлт', 2022, 'БНбД 31-24-22', 'https://legalinfo.mn/mn/detail?lawId=16531413277491', 'official_notice_only', true, ARRAY['Эрхлэгч', 'Арга зүйч', 'Багш']::TEXT[], 'Баталсан тушаал. Барилгын нормын бүрэн эх хавсралт болон шинэчлэлийг нягтлах. Холбоос нь зөвхөн баталсан тушаалыг нээнэ; БНбД 31-24-22 нормын бүрэн эх legalinfo.mn-д алга (2026-10-20).', '2026-10-19'::DATE, false, NOW(), NOW()),
  (gen_random_uuid(), 'SOB-030', 'Гарын авлага', 'Хөгжлөөс хэн ч хоцрох ёсгүй', 2024, NULL, 'https://moe.gov.mn/post/156051', 'official_repository_page', true, ARRAY['Эрхлэгч', 'Арга зүйч', 'Багш']::TEXT[], 'Тэгш хамруулах арга зүйн материал; хууль биш.', '2026-10-19'::DATE, false, NOW(), NOW()),
  (gen_random_uuid(), 'SOB-031', 'Гарын авлага', 'Хүүхдийн цэцэрлэгт тэгш хамран сургах үйл ажиллагааг зохион байгуулах нь', 2024, NULL, 'https://moe.gov.mn/post/156050', 'official_repository_page', true, ARRAY['Эрхлэгч', 'Арга зүйч', 'Багш']::TEXT[], 'Арга зүйн зөвлөмж; хууль биш.', '2026-10-19'::DATE, false, NOW(), NOW()),
  (gen_random_uuid(), 'SOB-032', 'Гарын авлага', 'Цэцэрлэгийн насны хүүхдэд зориулсан явуулын сургалтын гарын авлага', 2022, NULL, 'https://moe.gov.mn/post/123172', 'official_repository_page', true, ARRAY['Эрхлэгч', 'Арга зүйч', 'Багш']::TEXT[], NULL, '2026-10-19'::DATE, false, NOW(), NOW()),
  (gen_random_uuid(), 'SOB-033', 'Гарын авлага', 'Цэцэрлэгийн менежмент, манлайлал', 2020, NULL, 'https://cdn.greensoft.mn/uploads/users/2649/files/PDF%20files/asdasd-201123121518.pdf', 'official_pdf', false, ARRAY['Эрхлэгч', 'Арга зүйч']::TEXT[], 'Удирдах ажилтанд зориулсан арга зүйн материал.', '2026-10-19'::DATE, false, NOW(), NOW()),
  (gen_random_uuid(), 'SOB-034', 'Гарын авлага', 'СӨБ-ын байгууллагын сургалтын орчны стандартыг хэрэгжүүлэх зөвлөмж', 2020, NULL, 'https://cdn.greensoft.mn/uploads/users/2649/files/PDF%20files/asfasfasf-200918075356.pdf', 'official_pdf', false, ARRAY['Эрхлэгч', 'Арга зүйч', 'Багш']::TEXT[], '2015 оны стандарттай холбоотой материал; шинэ стандартаар солигдсон эсэхийг шалгах.', '2026-10-19'::DATE, false, NOW(), NOW()),
  (gen_random_uuid(), 'SOB-035', 'Гарын авлага', 'Цэцэрлэгийн хүүхэд хамгааллын бодлогыг хэрэгжүүлэх зөвлөмж', 2020, NULL, 'https://cdn.greensoft.mn/uploads/users/2649/files/PDF%20files/asdasdasd-201123121346.pdf', 'official_pdf', false, ARRAY['Эрхлэгч', 'Арга зүйч', 'Багш']::TEXT[], '2024 оны шинэчилсэн Хүүхэд хамгааллын тухай хуульд нийцүүлэн хэрэглэнэ; хуучин зөвлөмж.', '2026-10-19'::DATE, false, NOW(), NOW()),
  (gen_random_uuid(), 'SOB-036', 'Гарын авлага', 'Бага насны хүүхдийг хүчирхийллээс сэргийлэх, хамгаалах сургалтын модуль', 2020, NULL, 'https://cdn.greensoft.mn/uploads/users/2649/files/PDF%20files/asdsadd-200918074014.pdf', 'official_pdf', false, ARRAY['Эрхлэгч', 'Арга зүйч', 'Багш']::TEXT[], '2024 оны шинэ хууль, одоо мөрдөх журмыг орлохгүй.', '2026-10-19'::DATE, false, NOW(), NOW());
