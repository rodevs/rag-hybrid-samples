# hybrid-rag-guide

Guía escrita y laboratorio web interactivo de un **RAG híbrido** (búsqueda densa + BM25 + fusión RRF + reranking + generación con citas).
Todo el comportamiento es **simulado y determinista**: no hay llamadas a modelos ni a bases de datos reales. La página corre en el navegador.

## Qué incluye

| Sección de la web | Qué se puede hacer |
|---|---|
| **Inicio** | Página principal: qué aprenderás en cada fase, las 13 etapas con lo que enseña cada una, y sistemas reales (Qdrant, OpenSearch, Elasticsearch, Weaviate, Milvus, Vespa, pgvector, Azure AI Search, Pinecone, modelos y frameworks) que implementan esas técnicas, con enlaces a la etapa correspondiente. Si ya empezaste, ofrece continuar donde te quedaste. |
| **Recorrido** | 15 pasos, del problema (un modelo sin RAG inventa; con RAG cita) hasta el resumen de tu pregunta. Cada paso tiene cuatro capas: **la idea** en lenguaje simple con una analogía, **míralo** con la visualización, **experimenta** con un reto guiado y un botón que lo aplica, y **en la vida real** (plegada) con herramientas, código y notas de producción. En la fase de consulta, una barra en cada paso permite cambiar la pregunta, el modo de búsqueda y el reranking desde cualquier paso, y un panel compara los tres modos lado a lado. Hay comprobaciones al final de cada fase. |
| **Glosario** | 37 términos en lenguaje simple, con analogía, equivalentes reales y enlace al paso del lab. Cualquier palabra subrayada en el lab abre su definición. |
| **Camino avanzado** | Puerta de entrada a reindexado blue-green y dimensionamiento, con los términos que conviene conocer antes. |
| **Reindexado blue-green** (avanzado) | Explica qué son `docs_v1`, `docs_v2` (colecciones), `docs` (alias) y S3. Crear `docs_v2`, reindexar desde S3, ingerir un documento durante el reindexado (dual-write / catch-up), evaluar ambas colecciones y cambiar el alias. El tráfico de consultas muestra qué colección responde y qué pasa si el modelo de la API no coincide con el de la colección. |
| **Dimensionamiento** (avanzado) | Calculadora de RAM/disco para un índice HNSW según fragmentos, dimensiones, cuantización y `m`. |
| **Documentación** | La guía paso a paso y la revisión técnica ([`docs/`](docs/)), renderizadas con índice lateral. |

## En el teléfono (PWA)

La web es una app instalable que funciona sin conexión:

- **Un paso a la vez:** en pantallas de hasta 999 px el recorrido muestra una sola etapa, con barra de progreso, botones Anterior/Siguiente al alcance del pulgar y gesto de deslizar ← →. "Paso N de 13" abre la lista de todas las etapas.
- **Detalles plegables:** JSON, tablas secundarias y notas de producción empiezan plegados en móvil y recuerdan si los abriste.
- **Navegación inferior** con las cuatro secciones y objetivos táctiles de al menos 44 px. Los campos usan 16 px para evitar el zoom automático de iOS.
- **Retoma donde te quedaste:** la etapa, el avance y la última pregunta se guardan en el navegador.
- **Instalar:** botón "Instalar" en Android/Chrome. En iPhone: Safari → Compartir → "Agregar a inicio".
- **Sin conexión:** `sw.js` guarda la app, la documentación y las fuentes después de la primera visita. Al publicar cambios, sube `VERSION` en `sw.js`.

La instalación y el modo sin conexión requieren HTTPS (GitHub Pages lo da) o `localhost`.

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
npm test        # node --test sobre tests/engine.test.js y tests/learn.test.js (Node 18+)
```

Cubren el motor simulado: stemming, chunking, IDs deterministas, paráfrasis vs. código exacto, RRF, "no lo sé" fuera del corpus, cuarentena por prompt injection, verificación de citas, incompatibilidad de dimensiones y dimensionamiento.

## Estructura

```
hybrid-rag-guide/
├── index.html              # shell y portada (5 vistas por hash: #home, #lab, #bluegreen, #sizing, #docs)
├── manifest.webmanifest    # PWA: nombre, íconos, colores, accesos directos
├── sw.js                   # service worker: uso sin conexión
├── assets/
│   ├── css/app.css         # tokens de diseño (claro/oscuro), componentes y layout móvil
│   ├── icons/              # ícono SVG y PNG (192, 512, maskable, apple-touch)
│   └── js/
│       ├── corpus.js       # 8 documentos ficticios, preguntas de ejemplo y golden set
│       ├── engine.js       # motor RAG simulado (UMD: navegador y Node)
│       ├── systems.js      # sistemas reales de la portada y a qué etapa enlaza cada concepto
│       ├── learn.js        # glosario, comprobaciones por fase y respuestas "sin RAG"
│       └── app.js          # UI: render de etapas, blue-green, dimensionamiento, docs
├── docs/
│   ├── rag-hibrido-guia.md # guía paso a paso (código, Docker, Terraform, CI/CD)
│   └── REVISION.md         # hallazgos de la revisión técnica
├── tests/                  # engine.test.js (motor) y learn.test.js (integridad del contenido didáctico)
└── package.json
```

## Cómo funciona la simulación

| Pieza real | Simulación en `engine.js` |
|---|---|
| Modelo de embeddings | Vector = dimensiones de "concepto" (grupos de sinónimos escritos a mano) + dimensiones hash, normalizado. Captura paráfrasis ("asueto" ≈ "vacaciones") y falla con códigos exactos, igual que un modelo real. Dos "modelos" con distinta dimensión para demostrar incompatibilidades. |
| BM25 en Qdrant | Vector sparse `bm25` por chunk con TF saturada (k1 = 1.2, b = 0.75, longitud promedio fija como fastembed) e IDF calculado al consultar, como `Modifier.IDF`. La búsqueda densa, BM25 y RRF se muestran como la llamada equivalente a la Query API (`prefetch` + `fusion: rrf`). |
| RRF | Implementación real: `Σ 1/(k + posición)`. |
| Cross-encoder | Score 0–1 a partir de cobertura semántica, cobertura léxica ponderada por IDF y coincidencia de frases. |
| LLM | Extractivo: elige las oraciones más relevantes de los fragmentos y las cita con `[n]`. Pone en cuarentena fragmentos con instrucciones embebidas. |
| `doc_id` / IDs de punto | Hash FNV del contenido y UUID determinista (en producción: SHA-256 y `uuid5`). |

Los resultados sirven para entender el comportamiento, no como referencia de calidad o de costos reales.
