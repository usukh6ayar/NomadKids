# VPS_DEPLOYMENT.md — Datacom VPS дээр байршуулах

**Шийдвэр:** 2026-08-31. Railway-ээс татгалзаж, Datacom-ын VPS дээр бүх
сервисийг ажиллуулна — вэб, API, Postgres, Redis, файл хадгалалт.

**Төлөв:** тохиргоо бичигдсэн, сервер дээр хараахан ажиллуулаагүй.

---

## 1. Юу өөрчлөгдсөн бэ

Railway дөрвөн зүйлийг хийж өгдөг байсан. Одоо гурав нь `docker-compose.prod.yml`
дотор, нэг нь cron дээр:

| Railway хийдэг байсан | Одоо                                |
| --------------------- | ----------------------------------- |
| Managed PostgreSQL    | `db` сервис, Docker volume дээр     |
| Managed Redis         | `redis` сервис, AOF persistence-тэй |
| TLS сертификат        | Caddy, Let's Encrypt-ээс автоматаар |
| Сервис дахин асаах    | `restart: unless-stopped`           |
| **Шөнийн нөөцлөлт**   | **`scripts/backup.sh` + cron**      |

★ **Сүүлийнх нь хамгийн чухал өөрчлөлт.** Railway шөнө бүр Postgres-ын snapshot
авдаг байсан, хэн ч бодох шаардлагагүй. VPS дээр үүнийг хийх зүйл байхгүй —
бөгөөд алдааны үр дагавар нь эвдэрсэн deploy биш, **арван найман сарын дараа
үхэх диск** дээр хүүхэд бүрийн зураг, санхүүгийн бүх бүртгэл байгаа явдал.

★★ Cloudflare R2-ыг MinIO орлов. Код өөрчлөгдөөгүй — хоёулаа S3 API ярьдаг,
storage client нь тухайн шалтгаанаар S3-д зориулж бичигдсэн. **Өгөгдлийн
байршил өөрчлөгдсөн:** одоо бүх зураг Монголд үлдэнэ. `docs/SECURITY.md` §14.1
дэх D13 (өгөгдөл гадаад дахь үүлэн дэд бүтцэд байж болно) нь одоо хэрэглэгдэхгүй.

---

## 2. Байрлал

```
                        Интернэт
                            │
                    ┌───────▼────────┐   80/443 — ЗӨВХӨН энэ нээлттэй
                    │     Caddy      │   TLS, Let's Encrypt
                    └───┬────┬───┬───┘
          ┌─────────────┘    │   └──────────────┐
   nomadkids.mn      api.nomadkids.mn    media.nomadkids.mn
          │                 │                   │
    ┌─────▼─────┐    ┌──────▼──────┐     ┌──────▼──────┐
    │  web      │    │  api        │     │  storage    │
    │  Next.js  │───▶│  NestJS     │────▶│  MinIO      │
    │  :3000    │    │  +Chromium  │     │  :9000      │
    └───────────┘    └──┬───────┬──┘     └─────────────┘
                        │       │
                 ┌──────▼──┐ ┌──▼──────┐
                 │ db      │ │ redis   │
                 │ :5432   │ │ :6379   │
                 └─────────┘ └─────────┘

    ★ db, redis, storage нь хостын порт руу огт холбогдоогүй.
      Зөвхөн compose сүлжээнээс сервисийн нэрээр хүрнэ.
```

★★★ **Энэ нь энэ файлын хамгийн чухал шинж чанар.** Олон нийтийн VPS дээр
`0.0.0.0:5432` руу холбогдсон Postgres-ыг сканнер хэдхэн цагийн дотор олдог —
бөгөөд ихэнх compose жишээнд яг тэгж бичсэн байдаг. Шалгах:

```bash
docker compose -f docker-compose.prod.yml config --format json |
  python3 -c "import sys,json;[print(n, [p['published'] for p in (s.get('ports') or [])]) for n,s in json.load(sys.stdin)['services'].items()]"
```

`caddy` л порт харуулах ёстой.

---

## 3. Дараалал

### 3.1 Серверийг шалгах

```bash
# Репог сервер дээр татаад:
bash scripts/vps-preflight.sh
```

RAM, диск, Docker, порт, гадагш холболтыг шалгана. **Алдаа гарвал засагдтал
цааш явахгүй.** Шаардлага:

| Нөөц | Хамгийн бага | Тухтай |
| ---- | ------------ | ------ |
| RAM  | 2 ГБ + swap  | 4 ГБ   |
| Диск | 20 ГБ        | 80 ГБ  |

★ Chromium ганцаараа PDF үүсгэх үед ~1 ГБ авдаг (`docs/PDF_SPIKE.md` §3 дээр
хэмжсэн: 384 МБ дээр унана, 512 МБ дээр ажиллана). 2 ГБ сервер дээр **swap
заавал** — эс тэгвэл тайлан үүсгэх үед kernel API-г алах болно.

### 3.2 DNS

⛔ **Энэ алхмыг шууд хийж болохгүй. Энэ бол цоо шинэ систем биш, шилжилт.**

Энэ баримт 2026-08-31-нд, сервер байхаас өмнө бичигдсэн бөгөөд систем хоосон
гэж үзсэн. Бодит байдал (2026-09-01-нд шалгасан):

| Юу               | Хаана ажиллаж байна    |
| ---------------- | ---------------------- |
| `nomadkids.mn`   | **Vercel** — амьд      |
| `api.nomadkids.mn` | **Railway** — амьд, `/v1/health` → 200 |
| Postgres, Redis  | **Railway**            |
| Зураг, файл      | **Cloudflare R2**      |
| DNS              | Cloudflare (зөвхөн DNS) |

Доорх гурван A бичлэгийг **одоо** VPS рүү заавал хоосон систем олон нийтэд
гарна — Railway-гийн өгөгдлийн сан ч, R2-ийн объектууд ч тэр сервер дээр
байхгүй.

**Эхлээд түр нэрээр** бүх стекийг шалгана (`vps.`, `api-vps.`,
`media.nomadkids.mn`), дараа нь §3.7-гийн шилжилтийг хийнэ. Cloudflare дээр
**саарал үүл** байх ёстой — улбар шар бол Let's Encrypt-ийн HTTP-01 сорилд
Cloudflare-ийн edge хариулж, Caddy сертификат авахгүй.

Шилжилт дууссаны дараа л жинхэнэ гурван бичлэг:

```
nomadkids.mn         A    <VPS IP>
api.nomadkids.mn     A    <VPS IP>
media.nomadkids.mn   A    <VPS IP>
```

★★ **Гурвуулаа нэг registrable domain дор байх ёстой.** `docs/SECURITY.md` §3
нь вэб ба API нь same-site байхаас хамаарна: `SameSite=Lax` ажиллах, host-only
cookie хангалттай байх, хөтчийн өөрийн CSRF хамгаалалт үйлчлэх — гурвуулаа
үүн дээр тогтоно. Өөр домэйн дээр тавибал `SameSite=None` болж, системийн бүх
session сулрана.

DNS тархсаны **дараа** Caddy ажиллуулна — өөр рүү нь заагаагүй нэрэнд
сертификат авч чадахгүй.

### 3.3 Тохиргоо

```bash
cp .env.production.example .env.production
chmod 600 .env.production
ln -s .env.production .env      # ★★ энэ мөрийг алгасаж болохгүй
```

★★★ **Симлинк нь аюулгүй байдлын алхам, тохь тухынх биш.** `docker compose`
нь зөвхөн `.env` нэртэй файлыг өөрөө уншдаг. Түүнгүйгээр команд бүр дээр
`--env-file .env.production` гэж бичих ёстой болох ба **нэг удаа мартвал**
compose бүх хувьсагчийг хоосон мөр гэж үзнэ: Postgres нууц үггүй дахин
үүсэж, MinIO-гийн түлхүүр хоосон болж, домэйнууд алга болно. Симлинк нь тэр
алдааг гаргах боломжгүй болгоно.

Дараах утгуудыг үүсгэнэ:

```bash
openssl rand -base64 48   # JWT_SECRET
openssl rand -base64 48   # REFRESH_SECRET — ӨӨР утга байх ёстой
openssl rand -base64 32   # POSTGRES_PASSWORD
openssl rand -base64 32   # STORAGE_ACCESS_KEY_ID
openssl rand -base64 32   # STORAGE_SECRET_ACCESS_KEY
```

★ `JWT_SECRET` ба `REFRESH_SECRET` ижил байвал **ачаалахдаа татгалзана** —
refresh token нь access token болж баталгаажих нь хоёр түлхүүр байхын учрыг
устгана.

QPay-ийн таван утгыг мөн бөглөнө (`docs/reference/QPAY_INTEGRATION.md` §7).

### 3.4 Ажиллуулах

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f
```

★ `--env-file` бичихгүй байгаа нь §3.3-ын симлинк байгаа гэсэн үг. `docker
compose config --quiet` нь анхааруулгагүй байвал зөв.

Эхний ажиллуулалт 5–10 минут (image build). Дараалал:

1. `db`, `redis`, `storage` эрүүл болтол хүлээнэ
2. `storage-init` bucket үүсгээд гарна — **хувийн, versioned**
3. `api` эхлэхдээ миграцийг өөрөө хийнэ (`docker-entrypoint.sh`)
4. `caddy` гурван сертификат авна

### 3.5 Эхний администратор

`.env.production`-д эхлээд нууц үг тавина (12-оос дээш тэмдэгт), эс тэгвэл seed
администратор үүсгэхгүйгээр өнгөрнө:

```bash
echo "SEED_ADMIN_PASSWORD=$(openssl rand -base64 18 | tr -d /+=)" >> .env.production
docker compose -f docker-compose.prod.yml up -d api      # шинэ утгыг уншуулах
docker compose -f docker-compose.prod.yml exec api \
  sh -lc "cd apps/api && node_modules/.bin/tsx prisma/seed.ts"
```

★ `cd apps/api` нь заавал. Энэ мөр урьд нь `prisma/seed.ts` гэж бичигдсэн
байсан ч контейнерийн ажлын хавтас нь `/app`, скрипт нь `/app/apps/api/prisma/`
дотор байдаг — 2026-09-01-нд staging дээр анх ажиллуулах үед илэрсэн.

Хэрэглэгчийн нэр нь `superadmin`. Нууц үгээ дараа нь уншина:

```bash
grep SEED_ADMIN_PASSWORD /opt/nomadkids/.env.production
```

`docs/PROD_RECOVERY.md` §3.3-тай ижил — тэр баримт бичиг Railway-д зориулж
бичигдсэн ч seed-ийн алхам нь ижил.

### 3.6 Шалгах

```bash
curl -sf https://nomadkids.mn/login             > /dev/null && echo "web ✅"
curl -sf https://api.nomadkids.mn/v1/health     && echo " api ✅"
```

★ `ACCESS_FEE_AMOUNT` нь анхдагчаар `0` — хандалтын төлбөрийн хаалт **унтраалттай**.
Хураамж авах бол дүнг тавина (жишээ: `15000.00`); QPay-ийн таван утга мөн
тохируулагдсан байх ёстой, эс тэгвэл эцэг эх төлөх боломжгүй хаалттай тулна.

### 3.7 Кирилл фонтыг шалгах

`superadmin`-аар нэвтэрч шууд ажиллуулна:

```bash
curl -s -c cookies.txt -X POST https://<API_DOMAIN>/v1/auth/login \
  -H 'content-type: application/json' -H 'origin: https://<WEB_DOMAIN>' \
  -d '{"identifier":"superadmin","password":"<SEED_ADMIN_PASSWORD>"}'
curl -s -b cookies.txt https://<API_DOMAIN>/v1/health/readiness | jq
```

Энэ нь Chromium, Redis, storage, **кирилл фонт**, SMTP, QPay бүгдийг нэрлэнэ.
`cyrillicFont` нь `false` бол PDF хоосон гарна (`docs/PDF_SPIKE.md` §4).

★★ **Энэ route 2026-09-01 хүртэл шинээр seed хийсэн систем дээр 404 буцаадаг
байсан.** `RolesGuard` эрхийг `Membership`-ээс уншдаг, seed-ийн `superadmin` нь
ямар ч цэцэрлэгийн гишүүн биш — тиймээс шалгалт нь хамгийн хэрэгтэй мөчид,
цэцэрлэг үүсгэхээс өмнө, хүрэшгүй байсан. `@AllowSuperAdmin` нь тэр нэг route-ыг
нээв; guard өөрөө өргөжөөгүй бөгөөд багш урьдын адил 404 авна
(`test/health.test.ts`).

★ Нэвтрэхийн өмнө ч фонтыг логоос шалгаж болно:

```bash
docker compose -f docker-compose.prod.yml logs api | grep "Font check"
# Font check passed: 4 Mongolian-capable font(s) registered
```



---

### 3.7 Шилжилт — Vercel + Railway + R2-оос

★★★ **Хоёр зүйлийг нэг цэгээс авна.**

```bash
# 1. Өгөгдлийн сан
railway link -p NomadKids
railway connect Postgres        # эсвэл: pg_dump "$RAILWAY_DATABASE_URL" -Fc > cutover.dump
docker compose -f docker-compose.prod.yml exec -T db \
  pg_restore -U kinder -d kinder --clean --if-exists < cutover.dump

# 2. Файлууд — R2-оос MinIO руу
rclone config                   # нэг удаа: r2: ба minio: гэсэн хоёр remote
rclone sync r2:kinder-media minio:kinder-media --progress
```

Хоёулаа **нэг цэгээс** авагдаагүй бол сэргээсэн сан нь байхгүй объект руу
заасан `storageKey`-тэй мөрүүдтэй гарна: эвдэрсэн зурагтай портфолио, 404
буцаах медиа. §4-т бичсэн яг тэр зовлон, зөвхөн эсрэг чиглэлд.

Дараалал:

1. Түр нэр дээр стек ажиллаж, `/v1/health/readiness` бүрэн ногоон болсон байх
2. Railway дээрх бичилтийг зогсоох (богино засварын цонх)
3. `pg_dump` + `rclone sync`
4. `.env.production` дээрх домэйнуудыг жинхэнэ нэр рүү солих, стекийг дахин
   асаах
5. Cloudflare дээрх A бичлэгүүдийг VPS рүү заах (саарал үүл)
6. **Railway болон Vercel-ийг үлдээх** — эргэж буцах зам, §7-д зориудаар
   нээлттэй үлдээсэн
7. `scripts/backup.sh`-ыг **тэр өдөртөө** cron дээр тавих, `BACKUP_REMOTE`-той

---

## 4. Нөөцлөлт — заавал, шууд

```bash
crontab -e
```

```
15 2 * * * /opt/nomadkids/scripts/backup.sh >> /var/log/nomadkids-backup.log 2>&1
```

Скрипт хоёр зүйлийг авна: Postgres-ын dump ба MinIO-гийн бүх объект. **Хоёулаа
хэрэгтэй** — dump ганцаараа сэргээвэл `storageKey` нь байхгүй файл руу заасан
мөрүүдтэй мэдээллийн сан гарна: эвдэрсэн зурагтай портфолио, 404 буцаах медиа.

### 4.1 Сервер дээрээс гаргах

`.env.production`-д:

```
BACKUP_REMOTE=b2:nomadkids-backups
```

★★★ **Үүнгүйгээр нөөцлөлт нь нөөцлөлт биш.** Хамгаалж буй зүйлтэйгээ нэг
диск дээр байгаа хуулбар нь `DROP TABLE`-ыг даван гарах ч диск, дата төв,
төлөгдөөгүй нэхэмжлэлтэй хамт үхнэ.

```bash
rclone config                    # нэг удаа, интерактив
```

### 4.2 Сэргээж үзэх — эхний долоо хоногт

★ **Шалгаагүй нөөцлөлт бол итгэл үнэмшил, нөөцлөлт биш.** Өөр газар нэг удаа
сэргээж үз:

```bash
# Хоосон Postgres контейнер дээр
docker run --rm -d --name restore-test -e POSTGRES_PASSWORD=x -p 55432:5432 postgres:17-alpine
sleep 5
docker exec -i restore-test pg_restore -U postgres -d postgres --create < backups/db-YYYY-MM-DD_HHMM.dump
docker exec restore-test psql -U postgres -d kinder -c "select count(*) from children;"
docker rm -f restore-test
```

Тоо гарвал нөөцлөлт ажиллаж байна. Гарахгүй бол **одоо** мэдсэн нь дээр.

---

## 5. Ажиллагаа

```bash
# Шинэ хувилбар гаргах
git pull && docker compose -f docker-compose.prod.yml up -d --build
# (§3.3-ын `.env` симлинк байхгүй бол энэ команд нууц үгсийг хоосон болгоно)

# Лог
docker compose -f docker-compose.prod.yml logs -f api

# Нэг сервис дахин асаах
docker compose -f docker-compose.prod.yml restart api

# Санах ойн хэрэглээ — 2 ГБ сервер дээр тогтмол хараарай
docker stats --no-stream
```

★ **`docker compose down -v` бүү бич.** `-v` нь volume-уудыг устгана: бүх
мэдээллийн сан, бүх зураг. Нөөцлөлт нь `./backups/` дотор хостын файл системд
байгаа тул амьд үлдэнэ — тэр нь яг ийм гарын алдаанаас хамгаалахаар зориуд
тэнд байгаа.

### 5.1 MinIO console

Хэзээ ч нээлттэй биш. SSH tunnel-ээр:

```bash
ssh -L 9001:localhost:9001 user@server
docker compose -f docker-compose.prod.yml port storage 9001
```

Дараа нь `http://localhost:9001`. Тэнд бүх объектод бүрэн эрхтэй admin UI
байгаа тул олон нийтийн хаяг дээр нэг нууц үгээр хамгаалж болохгүй.

---

## 6. Юуг анхаарах вэ

### 6.1 Нэг сервер — нэг цэгийн эвдрэл

Railway дээр Postgres тусдаа managed сервис байсан. Одоо бүгд нэг машин дээр:
диск үхвэл бүгд алга. **Нөөцлөлт нь цорын ганц хамгаалалт** — §4-ийг үзнэ үү.

### 6.2 Санах ой

2 ГБ сервер дээр PDF үүсгэх үед бүгд чанга болно. `api` сервисд 2 ГБ хязгаар
тавьсан нь Chromium бүх машиныг идэхээс сэргийлнэ, гэхдээ swap байхгүй бол
kernel сонголт хийхээс өөр аргагүй. Хэрэв PDF үүсгэх үед API унтарч байвал:

```bash
# swap нэмэх
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### 6.3 Firewall

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

Docker нь ufw-г тойрч чаддаг тул compose дээр порт нээгээгүй байх нь **гол**
хамгаалалт хэвээр — firewall нь хоёр дахь давхарга.

---

## 7. Railway-гийн файлууд

`railway.json` ба `docs/RAILWAY_SETUP.md` нь **хадгалагдсан**, устгагдаагүй.
Тэдгээрт байгаа шийдвэрүүд — миграц яагаад entrypoint дээр ажилладаг, санах
ойн шаардлага яагаад тийм — платформоос үл хамааран хүчинтэй, мөн Railway руу
буцах шаардлага гарвал тэр зам нээлттэй байна.
