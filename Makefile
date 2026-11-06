.PHONY: setup dev test test-backend test-frontend test-browser demo

setup:
	python3 -m venv .venv
	.venv/bin/python -m pip install -r requirements.txt
	npm --prefix frontend ci
	.venv/bin/python backend/manage.py migrate --noinput

dev:
	bash scripts/dev.sh

test: test-backend test-frontend

test-backend:
	.venv/bin/python backend/manage.py check
	.venv/bin/python backend/manage.py makemigrations --check --dry-run
	.venv/bin/python backend/manage.py test followthrough -v 2

test-frontend:
	npm --prefix frontend test
	npm --prefix frontend run build

test-browser:
	npm --prefix e2e ci
	npm --prefix e2e exec playwright install chromium
	npm --prefix e2e test

demo:
	VITE_DEMO=true npm --prefix frontend run dev
