#!/usr/bin/env bash
#
# Reports whether a VPS can run this stack, before anything is deployed to it.
#
# ★ Read-only. It installs nothing, changes nothing, and starts nothing — so it
# is safe to run on a box somebody else is using, and safe to run twice.
#
# Run it ON THE SERVER:
#
#   bash vps-preflight.sh
#
# The two numbers that decide the deployment shape are RAM and disk. Chromium
# alone needs ~1 GB while rendering a PDF (docs/PDF_SPIKE.md §3), and MinIO now
# holds every photograph in the product, so the disk is not a rounding error.

set -u

pass=0
warn=0
fail=0

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; pass=$((pass + 1)); }
note() { printf '  \033[33m!\033[0m %s\n' "$1"; warn=$((warn + 1)); }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; fail=$((fail + 1)); }

echo
echo "NomadKids — VPS preflight"
echo "========================="

# ── The machine ──────────────────────────────────────────────────────────────
echo
echo "Систем:"

if [ -r /etc/os-release ]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  echo "  OS: ${PRETTY_NAME:-unknown}"
else
  note "OS хувилбарыг тодорхойлж чадсангүй (/etc/os-release алга)"
fi

echo "  Kernel: $(uname -sr)"
echo "  Architecture: $(uname -m)"

case "$(uname -m)" in
  x86_64|amd64|aarch64|arm64) ok "Дэмжигдсэн архитектур" ;;
  *) bad "Дэмжигдээгүй архитектур — Docker image нь amd64/arm64 дээр л бүтдэг" ;;
esac

# ── Memory ───────────────────────────────────────────────────────────────────
#
# ★ The floor is not a guess. `docs/PDF_SPIKE.md` §3 measures Chromium failing
# at 384 MB and working from 512 MB; 1 GB is the documented requirement with
# headroom. Everything else — Postgres, Redis, MinIO, Next.js, the API — sits
# on top of that.
echo
echo "Санах ой:"

if [ -r /proc/meminfo ]; then
  mem_kb=$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)
  mem_mb=$((mem_kb / 1024))
  swap_kb=$(awk '/^SwapTotal:/ {print $2}' /proc/meminfo)
  swap_mb=$((swap_kb / 1024))

  echo "  RAM:  ${mem_mb} MB"
  echo "  Swap: ${swap_mb} MB"

  if   [ "$mem_mb" -ge 7500 ]; then ok "8 ГБ+ — бүх сервис тухтай багтана"
  elif [ "$mem_mb" -ge 3800 ]; then ok "4 ГБ — хангалттай"
  elif [ "$mem_mb" -ge 1900 ]; then
    note "2 ГБ — ажиллана, гэхдээ чанга. Swap заавал, PDF үүсгэх үед хяна"
  else
    bad "2 ГБ-аас бага — Chromium ганцаараа ~1 ГБ шаарддаг"
  fi

  # Swap is what turns a memory spike into a slow request instead of an OOM
  # kill. On a 2 GB box it is the difference between a report that takes six
  # seconds and a worker the kernel shoots.
  if [ "$swap_mb" -lt 1000 ] && [ "$mem_mb" -lt 7500 ]; then
    note "Swap 1 ГБ-аас бага — PDF үүсгэх үед OOM болзошгүй (доор заавар)"
  fi
else
  note "Санах ойг уншиж чадсангүй (/proc/meminfo алга)"
fi

# ── Disk ─────────────────────────────────────────────────────────────────────
#
# MinIO holds every photograph and every generated PDF. A kindergarten of 200
# children with a term's photographs is a few GB; the backups are on top.
echo
echo "Диск:"

avail_mb=$(df -Pm / | awk 'NR==2 {print $4}')
echo "  / дээр сул: ${avail_mb} MB"

if   [ "$avail_mb" -ge 80000 ]; then ok "80 ГБ+ — зураг, нөөцлөлтөд тухтай"
elif [ "$avail_mb" -ge 40000 ]; then ok "40 ГБ — эхлэхэд хангалттай"
elif [ "$avail_mb" -ge 20000 ]; then note "20 ГБ — эхлэхэд болно, зургийн хэмжээг хянана"
else bad "20 ГБ-аас бага — MinIO бүх зураг, PDF-ийг энд хадгална"
fi

# ── Docker ───────────────────────────────────────────────────────────────────
echo
echo "Docker:"

if command -v docker >/dev/null 2>&1; then
  echo "  $(docker --version 2>/dev/null || echo 'docker --version амжилтгүй')"

  if docker info >/dev/null 2>&1; then
    ok "Docker демон ажиллаж байна, эрх хүрэлцэж байна"
  else
    # Almost always "user is not in the docker group" rather than a dead daemon.
    bad "Docker демонд хандаж чадсангүй — sudo хэрэгтэй эсвэл демон унтарсан"
    echo "      sudo usermod -aG docker \$USER && newgrp docker"
  fi

  if docker compose version >/dev/null 2>&1; then
    ok "docker compose (v2) бэлэн"
  elif command -v docker-compose >/dev/null 2>&1; then
    note "docker-compose v1 — v2 руу шинэчлэхийг зөвлөе (docker compose)"
  else
    bad "docker compose суугаагүй"
  fi
else
  bad "Docker суугаагүй"
  echo "      curl -fsSL https://get.docker.com | sh"
fi

# ── Ports ────────────────────────────────────────────────────────────────────
#
# Only 80 and 443 are published. Postgres, Redis and MinIO's own port stay on
# the compose network and are never bound to the host — see the compose file.
echo
echo "Портууд:"

port_busy() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]$1\$"
  elif command -v netstat >/dev/null 2>&1; then
    netstat -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]$1\$"
  else
    return 1
  fi
}

for p in 80 443; do
  if port_busy "$p"; then
    bad "Порт $p аль хэдийн эзэлсэн — Caddy TLS-ийг энд сонсоно"
  else
    ok "Порт $p сул"
  fi
done

# ── Outbound ─────────────────────────────────────────────────────────────────
#
# Let's Encrypt has to be reachable or there is no certificate, and QPay has to
# be reachable or no parent can pay.
echo
echo "Гадагш холболт:"

# ★ No `-f`. The question is whether the host is REACHABLE, not whether it
# authorises an anonymous request — and `curl -f` conflates the two.
#
# Docker Hub's `/v2/` answers **401** to a request with no token. That is the
# correct, documented response and it proves the registry was reached; `-f`
# reported it as "хүрч чадсангүй" and sent the first real deployment chasing a
# network problem that did not exist, while `docker pull` worked fine.
#
# Any HTTP status at all means the connection succeeded. Only curl's own `000`
# — no response — means it did not.
check_host() {
  if ! command -v curl >/dev/null 2>&1; then
    note "curl байхгүй тул $2-г шалгасангүй"
    return
  fi

  code=$(curl -sS --max-time 8 -o /dev/null -w '%{http_code}' "$1" 2>/dev/null || true)
  if [ -n "$code" ] && [ "$code" != "000" ]; then
    ok "$2 — HTTP $code"
  else
    note "$2 — хүрч чадсангүй"
  fi
}

check_host "https://acme-v02.api.letsencrypt.org/directory" "Let's Encrypt (TLS сертификат)"
check_host "https://merchant.qpay.mn/v2" "QPay"
check_host "https://registry-1.docker.io/v2/" "Docker Hub (image татах)"

# ── Summary ──────────────────────────────────────────────────────────────────
echo
echo "========================="
printf 'Дүн: \033[32m%d зөв\033[0m · \033[33m%d анхаарах\033[0m · \033[31m%d алдаа\033[0m\n' \
  "$pass" "$warn" "$fail"
echo

if [ "$fail" -gt 0 ]; then
  echo "Алдаа засагдтал байршуулж болохгүй."
  exit 1
fi

if [ "$warn" -gt 0 ]; then
  echo "Байршуулж болно, гэхдээ дээрх анхааруулгыг уншина уу."
  echo
  echo "Swap нэмэх (2 ГБ RAM-тай сервер дээр заавал):"
  echo "  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile"
  echo "  sudo mkswap /swapfile && sudo swapon /swapfile"
  echo "  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab"
  exit 0
fi

echo "Сервер бэлэн."
