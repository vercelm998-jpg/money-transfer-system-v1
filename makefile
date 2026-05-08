# Makefile
.PHONY: help dev prod build clean logs

help:
	@echo "أوامر Docker المتاحة:"
	@echo "  make dev        - تشغيل بيئة التطوير"
	@echo "  make prod       - تشغيل بيئة الإنتاج"
	@echo "  make build      - بناء الصور"
	@echo "  make down       - إيقاف الحاويات"
	@echo "  make clean      - تنظيف كامل"
	@echo "  make logs       - عرض السجلات"

dev:
	docker-compose -f docker-compose.dev.yml up

dev-build:
	docker-compose -f docker-compose.dev.yml up --build

dev-down:
	docker-compose -f docker-compose.dev.yml down

prod:
	docker-compose up -d

prod-build:
	docker-compose up -d --build

prod-down:
	docker-compose down

build:
	docker build -t money-transfer-app .

logs:
	docker-compose logs -f

clean:
	docker-compose down -v
	docker-compose -f docker-compose.dev.yml down -v
	docker system prune -f