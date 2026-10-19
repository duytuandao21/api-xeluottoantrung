cd /var/www/xeluottoantrung/api

# 1. Cập nhật source
git pull

# 2. Cài dependencies
npm ci

# 3. Kiểm tra migration
npx drizzle-kit check --config=drizzle.config.ts

# 4. Backup database trước khi áp dụng migration mới
sudo -u postgres pg_dump -Fc \
  -d xeluottoantrung_test \
  -f "/tmp/xeluottoantrung_test_$(date +%Y%m%d_%H%M%S).dump"

# 5. Áp dụng migration mới
npm run db:migrate

# 6. Build API
npm run build

# 7. Restart API
sudo systemctl restart api-xeluottoantrung

# 8. Kiểm tra API
curl -i http://127.0.0.1:4000/health
curl -i http://127.0.0.1:4000/api/v1/cars