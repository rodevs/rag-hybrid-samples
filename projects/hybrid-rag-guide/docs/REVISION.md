# Revisión técnica — "RAG Híbrido: Implementación Paso a Paso"

Revisión del documento original. La versión corregida está en
[`rag-hibrido-guia.md`](./rag-hibrido-guia.md). Aquí se explica **qué se cambió y por qué**.

> Alcance de esta iteración: solo el contenido del documento (explicaciones, snippets,
> Terraform y workflows *dentro* de la guía). No se implementó código en el repo.

---

## 1. Valoración general

El documento está bien planteado: la explicación conceptual (Paso -1) es clara, la
separación indexación/consulta es correcta, y los temas de operación (OIDC, alias de
colección, blue-green, documentos fuente en S3) son los que la mayoría de guías omiten.

Sin embargo, **varios snippets no funcionan tal como están** y hay inconsistencias
entre secciones (lo que el Paso 11 asume no coincide con lo que el Paso 5 construye).
Si alguien sigue la guía literalmente, falla en la ingesta, en Docker Compose, en el
deploy (OIDC + Terraform) y en el reindexado.

---

## 2. Hallazgos por severidad

### 🔴 Críticos — rompen la ejecución tal como está escrito

| # | Sección | Problema | Corrección aplicada |
|---|---------|----------|---------------------|
| C1 | Paso 5 `pipeline.py` | `id=f"{doc_id}-{i}"` — Qdrant **solo acepta enteros sin signo o UUID** como ID de punto. El upsert falla. | IDs deterministas con `uuid5(NAMESPACE, f"{doc_id}:{i}")`. |
| C2 | Paso 6 `hybrid.py` | RRF usa `item["doc_id_chunk"]`, clave que ni el payload de Qdrant ni el BM25 producen → `KeyError`. Además devuelve solo `(id, score)` y se pierde el texto. | RRF genérico sobre una clave `id` común; conserva el item completo. |
| C3 | Paso 4 Compose | `.env` define `QDRANT_URL=http://localhost:6333`; dentro del contenedor `api`, `localhost` es el propio contenedor, no Qdrant. | En Compose se sobreescribe a `http://qdrant:6333` + `healthcheck`. |
| C4 | Paso 5 vs Paso 11 | Paso 5 crea una **colección** llamada `docs`; Paso 11 quiere un **alias** `docs`. Qdrant no permite un alias con el mismo nombre de una colección existente → el blue-green no se puede aplicar sin migración. | Desde el día uno: colección `docs_v1` + alias `docs`. |
| C5 | Paso 10.2 OIDC | `deploy.yml` usa `environment: production`; con eso el claim `sub` del token es `repo:OWNER/REPO:environment:production`, **no** `...:ref:refs/heads/main` → `AssumeRoleWithWebIdentity` es rechazado. Falta además la condición `aud`. | Condición con `aud` y `sub` por environment. |
| C6 | Paso 8 / 10.4 | `terraform apply -var="image_tag=..."` pero la variable no está declarada (error "undeclared variable"); el `aws_ecs_service` `rag-api-service` que se actualiza en el workflow **no existe** en Terraform; no hay VPC/subnets/SG/ALB/ECR/logs. | Se declara `image_tag`, se añade el servicio, ECR, logs y se listan los recursos de red requeridos. |
| C7 | Paso 8 / 10.4 | No hay **backend remoto** de Terraform. Ejecutado en un runner efímero de GitHub, el state se pierde en cada run → Terraform intentará recrear todo. | Backend S3 con cifrado y bloqueo (`use_lockfile`). |
| C8 | Paso 8 IAM | El execution role no tiene `AmazonECSTaskExecutionRolePolicy` → la tarea no puede descargar la imagen de ECR ni escribir logs. | Se adjunta la política gestionada correcta. |
| C9 | Paso 11 reindex | `chunk_text(text, **CHUNKING_CONFIG_V2)` pasa `strategy=`, que la función no acepta (`TypeError`); `embed(chunks, model=...)` no coincide con la firma; `.read().decode()` sobre un **PDF** binario falla. | Firma con `strategy`, `embed(..., model)`, y se guarda en S3 el texto extraído además del original. |
| C10 | Paso 10.3 CI | Tests con `QDRANT_URL=localhost:6333` pero no hay Qdrant en el job → fallan. `Settings()` se instancia al importar y truena sin `OPENAI_API_KEY` (PRs desde forks no reciben secrets). | `services: qdrant` en el job y mocks para embeddings/LLM en tests unitarios. |

### 🟠 Importantes — funcionan, pero con riesgo real en producción

| # | Sección | Problema | Recomendación |
|---|---------|----------|---------------|
| I1 | Paso 6 BM25 | `rank_bm25` vive **en memoria**, se reconstruye completo, no se persiste y no se dice de dónde sale el `corpus`. Contradice la sección de "millones de documentos". Tokenización `.split()` sin minúsculas ni puntuación ("Folio:" ≠ "folio"). | Usar **sparse vectors BM25 nativos de Qdrant** (`Modifier.IDF`) + `query_points` con `prefetch` y `Fusion.RRF` (Qdrant ≥ 1.10). Un solo almacén, un solo alias, se versiona junto con el denso. |
| I2 | Paso 6 | El texto promete top-20 → rerank → top-5, pero el código hace `fused[:5]` sin rerank. Faltan `dense.py`, `generate.py` y el endpoint `/query` que el checklist da por hecho. | Se añaden rerank (Cohere o cross-encoder local), generación con citas y verificación de citas. |
| I3 | Paso 7 | `async def ingest` llama código **síncrono y bloqueante** (PDF + OpenAI + Qdrant) → bloquea el event loop para todas las requests. | Endpoint `def` (FastAPI lo corre en threadpool) o cola de ingesta asíncrona. |
| I4 | Paso 7 | `doc_id = file.filename` → dos PDFs distintos llamados `reporte.pdf` se pisan. Sin límite de tamaño, sin validar tipo, sin auth. | `doc_id` = hash SHA-256 del contenido (o UUID) y `source` = filename. |
| I5 | Paso 7 vs Paso 11 | El Paso 11 exige guardar originales en S3 "desde el día uno", pero la ingesta del Paso 7 **no lo hace**. | La ingesta sube original + texto extraído a S3 antes de indexar. |
| I6 | Paso 11 | Mientras se construye `docs_v2` (horas), los documentos nuevos o editados entran solo a `docs_v1` → se pierden en el switch. | Dual-write o *catch-up* por `updated_at` antes del switch. |
| I7 | Paso 11 | Un job de GitHub Actions dura máximo 6 h (runners hospedados); "millones de documentos" no cabe. | El workflow solo **dispara** un job en AWS Batch/ECS + SQS. |
| I8 | Paso 8 IAM | `SecretsManagerReadWrite` da lectura/escritura/borrado de **todos** los secrets de la cuenta. | Política inline con `secretsmanager:GetSecretValue` solo sobre los ARNs necesarios. |
| I9 | Paso 5 | `embed()` manda todos los chunks en una sola llamada; la API de embeddings tiene límites por request (nº de inputs y tokens totales). Sin reintentos. `chunk_text` entra en loop infinito si `overlap >= size`; PDF escaneado → texto vacío → `embed([])` falla. | Batching, reintentos con backoff y validaciones. |
| I10 | Paso -1 costos | Se dice que el rerank es "normalmente el costo más alto por query" y, dos líneas después, que el LLM "suele ser el costo dominante". Contradictorio. | El LLM suele ser dominante; el rerank es el segundo costo variable. |
| I11 | Paso 10 | Se configuran `AWS_ACCESS_KEY_ID/SECRET` y a la vez se recomienda OIDC. Mensaje mixto. | Solo OIDC; `AWS_REGION` como *variable*, no secret. |
| I12 | Paso 10.4 | `terraform apply` + `update-service --force-new-deployment` + tag `latest`: dos fuentes de verdad para la imagen desplegada; sin `concurrency` puede haber dos deploys simultáneos. | Terraform es dueño del `image_tag`; `aws ecs wait services-stable`; circuit breaker con rollback. |
| I13 | Seguridad | No se menciona *prompt injection* desde documentos, control de acceso por tenant, límites de upload, auth en endpoints, ni PII en logs. | Nueva sección "Seguridad". |
| I14 | Paso 9 | La API de RAGAS cambió (≥ 0.2: `EvaluationDataset`, `SingleTurnSample`, LLM evaluador explícito). El snippet es de la API vieja. Sin métricas de retrieval puras. | Golden set + Recall@k/MRR para retrieval + RAGAS para generación. |

### 🟡 Menores / de claridad

| # | Sección | Observación |
|---|---------|-------------|
| M1 | Referencias | "ver Paso 6" para Secrets Manager/Terraform → es el **Paso 8**. |
| M2 | Paso 11.2 | Sub-pasos llamados "Paso 1…6" dentro del Paso 11 confunden con los pasos principales → renombrados 11.2.1…11.2.7 (se añadió 11.2.4, *catch-up* durante el reindexado). |
| M3 | Paso 3 | `class Config` es estilo pydantic v1; en pydantic-settings v2 es `model_config = SettingsConfigDict(...)`. |
| M4 | Paso 5 | Dimensión `1536` hardcodeada, desacoplada de `embedding_model` → si cambias el modelo, se rompe en silencio. |
| M5 | Paso 2 | `sentence-transformers` se instala pero no se usa (arrastra PyTorch, varios GB en la imagen). Faltan `cohere`, `boto3`, `tenacity`. Versiones de 2024: usar lockfile y actualizar. |
| M6 | Paso 0 | "OpenAI o Anthropic para embeddings": Anthropic no ofrece API de embeddings (recomienda Voyage AI). El código solo usa OpenAI. |
| M7 | Paso 0 | `brew install terraform` ya no está en Homebrew core tras el cambio de licencia; usar `hashicorp/tap/terraform` (u OpenTofu). |
| M8 | Paso 4 | Dockerfile sin `.dockerignore` (riesgo de copiar `.env`), corre como root, sin `HEALTHCHECK`. |
| M9 | Paso 10.2 | `thumbprint_list` ya no lo valida AWS para GitHub; en versiones recientes del provider es opcional. |
| M10 | Paso 10.5 | ECR con tags inmutables (recomendado) es incompatible con re-pushear `latest`. |
| M11 | Paso 1 | Falta `scripts/` (usado en Paso 11) y `app/retrieval/dense.py` referenciado implícitamente. |
| M12 | Paso -1 | Faltan números concretos de escala: 10 M chunks × 1536 dims × 4 B ≈ 60 GB solo en vectores → cuantización. |
| M13 | Citas | Para citar se necesita **número de página**; el pipeline concatena páginas y pierde esa metadata. |
| M14 | `/health` | No verifica Qdrant → el balanceador enruta a tareas sin backend. Separar *liveness* y *readiness*. |

---

## 3. Contenido nuevo añadido a la guía

- **Paso 6 alternativo (recomendado):** híbrido nativo en Qdrant (dense + sparse BM25 + RRF en una sola query).
- **Paso 7.2:** `/query` completo — retrieval → rerank → generación → verificación de citas.
- **Paso 12 — Seguridad** (prompt injection, multi-tenant, auth, PII).
- **Paso 13 — Observabilidad** (latencia por etapa, trazas, métricas de calidad online).
- **Dimensionamiento** de memoria del índice y cuantización.
- Checklist final ampliado.

## 4. Decisiones abiertas (para el equipo)

1. **BM25 en memoria vs. sparse vectors en Qdrant vs. OpenSearch.** Recomendación: sparse
   en Qdrant (menos piezas). OpenSearch solo si ya existe en la organización o se necesitan
   analizadores lingüísticos avanzados para español (stemming, sinónimos).
2. **Rerank vía API (Cohere) vs. cross-encoder autohospedado.** API = cero operación, costo por
   documento; local = costo fijo de GPU/CPU y latencia controlada.
3. **Multi-tenancy:** payload `tenant_id` con índice `is_tenant` (recomendado por Qdrant) vs.
   una colección por tenant (solo para pocos tenants grandes con requisitos de aislamiento).
4. **Proveedor de LLM y de embeddings:** la guía usa OpenAI; si se usa Claude para generación,
   los embeddings seguirían en otro proveedor (OpenAI, Voyage, Cohere o modelo local).
