# IBirdOS V3 — Production Deployment Guide

## 1. Infrastructure prerequisites

- Kubernetes 1.28+ cluster with `ingress-nginx` + `cert-manager` installed
- Managed Postgres 16 (or in-cluster, see `k8s/base/postgres-statefulset.yaml`)
- Managed Redis 7+ (or in-cluster)
- Object storage (Cloudflare R2 / S3-compatible)
- Container registry (GHCR / ECR / GCR)
- Domain with DNS pointing to ingress controller IP

## 2. External service credentials

| Service | Required env vars |
|---------|-------------------|
| Stripe  | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| OpenAI  | `OPENAI_API_KEY` |
| R2/S3   | `STORAGE_ENDPOINT`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY` |
| Sysco   | `SYSCO_API_BASE`, `SYSCO_CLIENT_ID`, `SYSCO_CLIENT_SECRET` (optional) |
| Sentry  | `SENTRY_DSN` (optional) |
| OTel    | `OTEL_EXPORTER_OTLP_ENDPOINT` (optional) |

## 3. Build images

```bash
docker build -t ghcr.io/ibirdos/api:v1.0.0 -f apps/api/Dockerfile .
docker build -t ghcr.io/ibirdos/workers:v1.0.0 -f apps/api/Dockerfile.worker .
docker build -t ghcr.io/ibirdos/web:v1.0.0 -f apps/web/Dockerfile .

docker push ghcr.io/ibirdos/api:v1.0.0
docker push ghcr.io/ibirdos/workers:v1.0.0
docker push ghcr.io/ibirdos/web:v1.0.0
```

## 4. Configure secrets

Edit `k8s/base/secret.yaml` and replace stub values. **Do not commit real secrets.** Use Sealed Secrets / External Secrets Operator / 1Password Operator instead.

For HSTS preload + cert-manager, edit `k8s/base/ingress.yaml` host names.

## 5. Apply

```bash
# Create namespace + run migration
kubectl apply -k k8s/overlays/prod

# Verify
kubectl get pods -n ibirdos
kubectl logs -n ibirdos -l app=api --tail=50
```

## 6. Seed billing plans

```bash
kubectl run -n ibirdos --rm -it --image=ghcr.io/ibirdos/api:v1.0.0 \
  --env-from=secret/ibirdos-secrets --env-from=configmap/ibirdos-config \
  seed -- pnpm --filter @ibirdos/db run seed
```

## 7. Stripe webhook endpoint

Configure your Stripe webhook to point to `https://api.ibirdos.com/api/v1/billing/webhook` and listen for:
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_succeeded`
- `invoice.payment_failed`

Copy the signing secret to `STRIPE_WEBHOOK_SECRET`.

## 8. Smoke test

```bash
curl https://api.ibirdos.com/api/v1/health/ready
# {"ok":true,"data":{"status":"ready","checks":{"db":"ok","redis":"ok"}}}

# Open https://app.ibirdos.com — should redirect to /login
```

## 9. Observability

- Prometheus scrapes `/metrics` on the API pod (annotation already set)
- Sentry receives error traces (set `SENTRY_DSN`)
- OpenTelemetry exports spans to `OTEL_EXPORTER_OTLP_ENDPOINT` if set

## 10. Backup strategy

- Postgres: daily pg_dump → object storage with 30-day retention
- Redis: AOF persistence already enabled in StatefulSet
- Object storage (uploads): provider-level versioning

## Rollback

```bash
kubectl rollout undo deployment/api -n ibirdos
kubectl rollout undo deployment/workers -n ibirdos
kubectl rollout undo deployment/web -n ibirdos
```
