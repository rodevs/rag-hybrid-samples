# rag-hybrid-samples

Multirepo de ejemplos, guías y pruebas de concepto (PoC) sobre **RAG** (Retrieval-Augmented Generation).
Cada proyecto vive en su propia carpeta dentro de [`projects/`](projects/) y es autocontenido: su código, su documentación, sus tests y sus instrucciones de ejecución.

## Proyectos

| Proyecto | Tipo | Descripción |
|---|---|---|
| [`hybrid-rag-guide`](projects/hybrid-rag-guide/) | Guía + web interactiva | Guía paso a paso de un RAG híbrido (dense + BM25 + RRF + rerank) con su revisión técnica, y un laboratorio web simulado para recorrer indexación, consulta, almacenamiento y reindexado blue-green. |

## Convenciones

- **Una carpeta por proyecto:** `projects/<nombre-en-kebab-case>/`.
- **README obligatorio** en cada proyecto con: qué es, cómo ejecutarlo, cómo probarlo y su estructura.
- **Autocontenido:** dependencias, lockfiles, `.env.example`, Dockerfile e infraestructura dentro de la carpeta del proyecto. Nada compartido implícitamente entre proyectos.
- **Documentación** en `projects/<nombre>/docs/`.
- **Secretos:** nunca en el repo. Cada proyecto con credenciales incluye un `.env.example`; los `.env` están ignorados en la raíz.
- **CI por proyecto:** un workflow en `.github/workflows/<nombre>.yml` filtrado por `paths: projects/<nombre>/**`, para que un cambio en un proyecto no dispare los demás.

## Sitio en GitHub Pages

El workflow [`pages.yml`](.github/workflows/pages.yml) publica cada `projects/<nombre>/` que tenga un `index.html` en `https://<usuario>.github.io/rag-hybrid-samples/<nombre>/`, con una portada que lista los proyectos. Se ejecuta en cada push a `main` que toque `projects/**` (o manualmente desde Actions). En los PR solo valida que el sitio se genere.

Para generarlo localmente:

```bash
bash scripts/build-pages.sh _site
python3 -m http.server 8080 -d _site
```

Configuración única en GitHub:

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
2. **Settings → General → Default branch: `main`.** El environment `github-pages` solo acepta despliegues desde la rama por defecto.
3. En repositorios **privados**, GitHub Pages requiere un plan de pago (Pro, Team o Enterprise). En el plan gratuito, el repositorio tiene que ser público.

## Agregar un proyecto

1. Crea `projects/<nombre>/` con su `README.md`.
2. Agrega una fila a la tabla de proyectos de arriba.
3. Si tiene tests, agrega `.github/workflows/<nombre>.yml` con el filtro de `paths`.
4. Si tiene una web estática, basta con un `index.html` en la raíz del proyecto para que Pages la publique.
