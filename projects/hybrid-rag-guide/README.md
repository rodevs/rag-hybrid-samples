# hybrid-rag-guide

Guía escrita y laboratorio web interactivo de un **RAG híbrido** (búsqueda densa + BM25 + fusión RRF + reranking + generación con citas).
Todo el comportamiento es **simulado y determinista**: no hay llamadas a modelos ni a bases de datos reales. La página corre en el navegador.

## Qué incluye

| Sección de la web | Qué se puede hacer |
|---|---|
| **Recorrido** | Las 13 etapas del pipeline, de la indexación a la verificación de citas. Cada etapa muestra qué entra, qué sale, qué se guarda y qué cambia en producción. Puedes editar el corpus, el chunking, el modelo de embeddings, la pregunta, el modo de búsqueda, `k` de RRF, el umbral de rerank y simular una alucinación. |
| **Reindexado blue-green** | Crear `docs_v2`, reindexar desde S3, ingerir un documento durante el reindexado (dual-write / catch-up), evaluar ambas colecciones y cambiar el alias. El tráfico de consultas muestra qué colección responde y qué pasa si el modelo de la API no coincide con el de la colección. |
| **Dimensionamiento** | Calculadora de RAM/disco para un índice HNSW según fragmentos, dimensiones, cuantización y `m`. |
| **Documentación** | La guía paso a paso y la revisión técnica ([`docs/`](docs/)), renderizadas con índice lateral. |

## Ejecutar

La página carga los Markdown de `docs/` con `fetch`, así que necesita un servidor HTTP (abrir `index.html` como archivo no carga la documentación):

```bash
cd projects/hybrid-rag-guide
python3 -m http.server 8080      # o: npm start
# abre http://localhost:8080
```

No hay paso de build ni dependencias de npm. Se cargan desde CDN las fuentes (Google Fonts) y `marked` (cdnjs) para renderizar Markdown.

## Tests

```bash
cd projects/hybrid-rag-guide
npm test        # equivale a: node --test tests/engine.test.js   (Node 18+)
```

Cubren el motor simulado: stemming, chunking, IDs deterministas, paráfrasis vs. código exacto, RRF, "no lo sé" fuera del corpus, cuarentena por prompt injection, verificación de citas, incompatibilidad de dimensiones y dimensionamiento.

## Estructura

```
hybrid-rag-guide/
├── index.html              # shell de la página (4 vistas por hash: #lab, #bluegreen, #sizing, #docs)
├── assets/
│   ├── css/app.css         # tokens de diseño (claro/oscuro) y componentes
│   └── js/
│       ├── corpus.js       # 8 documentos ficticios, preguntas de ejemplo y golden set
│       ├── engine.js       # motor RAG simulado (UMD: navegador y Node)
│       └── app.js          # UI: render de etapas, blue-green, dimensionamiento, docs
├── docs/
│   ├── rag-hibrido-guia.md # guía paso a paso (código, Docker, Terraform, CI/CD)
│   └── REVISION.md         # hallazgos de la revisión técnica
├── tests/engine.test.js
└── package.json
```

## Cómo funciona la simulación

| Pieza real | Simulación en `engine.js` |
|---|---|
| Modelo de embeddings | Vector = dimensiones de "concepto" (grupos de sinónimos escritos a mano) + dimensiones hash, normalizado. Captura paráfrasis ("asueto" ≈ "vacaciones") y falla con códigos exactos, igual que un modelo real. Dos "modelos" con distinta dimensión para demostrar incompatibilidades. |
| Vector sparse / BM25 | TF saturada (k1 = 1.2, b = 0.75) guardada al indexar; IDF aplicado al consultar, como `Modifier.IDF` en Qdrant. |
| RRF | Implementación real: `Σ 1/(k + posición)`. |
| Cross-encoder | Score 0–1 a partir de cobertura semántica, cobertura léxica ponderada por IDF y coincidencia de frases. |
| LLM | Extractivo: elige las oraciones más relevantes de los fragmentos y las cita con `[n]`. Pone en cuarentena fragmentos con instrucciones embebidas. |
| `doc_id` / IDs de punto | Hash FNV del contenido y UUID determinista (en producción: SHA-256 y `uuid5`). |

Los resultados sirven para entender el comportamiento, no como referencia de calidad o de costos reales.
