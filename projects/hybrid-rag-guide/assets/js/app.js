/* UI del laboratorio. Depende de window.RagEngine y window.RagCorpus. */
(function () {
  'use strict';
  const E = window.RagEngine;
  const C = window.RagCorpus;
  const L = window.RagLearn;

  // ================================================================ utilidades
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fx = (x, d = 3) => Number(x).toFixed(d);
  const pct = x => Math.round(x * 100) + '%';
  const bytes = n => {
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    while (n >= 1000 && i < u.length - 1) { n /= 1000; i++; }
    return (n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)) + ' ' + u[i];
  };
  let toastTimer;
  function toast(msg) {
    let t = $('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
  }
  // pantalla angosta: un paso a la vez, paneles secundarios plegados
  const mq = window.matchMedia('(max-width: 999px)');
  const isMobile = () => mq.matches;
  const STORE_KEY = 'rag-lab-v1';
  const saved = (() => { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; } })();
  function persist() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ stage: S.stage, visited: [...S.visited], query: S.query, quiz: S.quiz })); } catch (e) { /* almacenamiento no disponible */ }
  }
  // estado abierto/cerrado de los paneles plegables, para que sobreviva a los re-render
  const FOLDS = {};
  document.addEventListener('toggle', e => {
    const d = e.target;
    if (d.matches && d.matches('details[data-fold]')) FOLDS[d.dataset.fold] = d.open;
  }, true);
  const foldOpen = (key, dflt) => (FOLDS[key] !== undefined ? FOLDS[key] : dflt) ? ' open' : '';
  const docByKey = (docs, key) => docs.find(d => d.key === key);
  const shortOf = key => (docByKey(S.docs, key) || docByKey([C.LATE_DOC], key) || { short: key.slice(0, 3).toUpperCase() }).short;

  // ================================================================ estado del laboratorio
  const S = {};
  function initLab(fresh) {
    Object.assign(S, {
      docs: C.DOCS.map(d => Object.assign({}, d, { enabled: true })),
      cfg: { name: 'docs_v1', size: 40, overlap: 8, model: 'mock-embed-small' },
      query: C.SAMPLE_QUERIES[0].q,
      opts: Object.assign({}, E.DEFAULTS),
      stage: 'problem',
      quiz: {},
      docKey: 'vacaciones',
      pointId: null,
      s3Key: null,
      simA: 'el gato duerme en el sofá',
      simB: 'el felino descansa en el mueble',
      visited: new Set(['docs']),
      newTitle: 'Lineamientos de estacionamiento',
      newText: C.LATE_DOC.pages.join('\n\n'),
    });
    if (!fresh) {
      if (saved.stage && STAGES.some(st => st.id === saved.stage)) S.stage = saved.stage;
      if (Array.isArray(saved.visited)) saved.visited.forEach(v => S.visited.add(v));
      if (typeof saved.query === 'string' && saved.query.trim()) S.query = saved.query;
      if (saved.quiz && typeof saved.quiz === 'object') S.quiz = saved.quiz;
    }
    rebuild();
  }
  function rebuild() {
    S.index = E.buildIndex(S.docs.filter(d => d.enabled), S.cfg);
    S.pca = S.index.points.length > 2 ? E.pca2(S.index.points.map(p => p.vector)) : null;
    if (!S.index.points.some(p => p.id === S.pointId)) {
      const first = S.index.points.find(p => p.docKey === S.docKey) || S.index.points[0];
      S.pointId = first ? first.id : null;
    }
    rerun();
  }
  function rerun() { S.trace = E.runQuery(S.index, S.query, S.opts); }
  const selPoint = () => S.index.points.find(p => p.id === S.pointId);

  // ================================================================ etapas
  // Cada etapa se muestra en capas: la idea (lenguaje simple), míralo (visualización),
  // experimenta (un reto guiado) y en la vida real (herramientas, código y producción).
  // [[clave]] o [[clave|texto]] en los textos abre el glosario (assets/js/learn.js).
  const STAGES = [
    { id: 'problem', phase: 'intro', title: 'El problema: un modelo sin tus documentos', ref: 'Paso -1',
      learn: 'Por qué un modelo de lenguaje inventa respuestas y cómo RAG lo evita.',
      io: ['Una pregunta', 'Dos respuestas: sin RAG y con RAG'],
      idea: 'Un [[llm]] solo sabe lo que aprendió en su entrenamiento: no conoce los documentos de tu empresa. Si le preguntas algo de ellos, puede inventar una respuesta que suena segura (una [[alucinacion]]). Un sistema [[rag]] primero busca en tus documentos y le da al modelo solo lo relevante, para que responda con fuentes.',
      analogy: 'Es la diferencia entre contestar un examen de memoria y contestarlo a libro abierto.',
      tools: 'El modelo puede ser GPT, Claude o un modelo abierto. Todo el recorrido explica cómo se construye la búsqueda que lo alimenta.',
      prod: ['Nunca confíes en una respuesta sin fuente cuando se trata de información interna.', 'Un buen RAG también sabe decir "no lo sé" cuando sus documentos no cubren la pregunta.'] },
    { id: 'docs', phase: 'index', title: 'Los documentos', ref: 'Paso 7',
      learn: 'Qué documentos entran al sistema y por qué conviene guardar los originales.',
      io: ['Archivos PDF', 'Documentos listos para procesar'],
      idea: 'Todo empieza con el [[corpus]]: los documentos que el sistema podrá consultar. Aquí hay 8 documentos ficticios de una empresa (políticas, facturas, manuales). Puedes apagar alguno o agregar uno tuyo y verás cómo cambia todo lo demás.',
      analogy: 'Es la biblioteca del sistema: si un libro no está en el estante, nadie lo podrá consultar.',
      tools: 'En producción los documentos llegan por una API de carga y los originales se guardan en un almacén de archivos como [[s3]].',
      prod: ['Guarda cada original en un almacén durable ([[s3]] o similar) desde el primer día: es la fuente para volver a indexar.', 'Usa como identificador un [[hash]] del contenido o un ID estable del sistema de origen, nunca el nombre del archivo.', 'Valida tipo y tamaño del archivo y exige autenticación para subir documentos.'] },
    { id: 'parse', phase: 'index', title: 'Leer el PDF (parseo)', ref: 'Paso 5',
      learn: 'Cómo un PDF se vuelve texto por página y por qué el identificador es un hash del contenido.',
      io: ['PDF', 'Texto por página + identificador'],
      idea: 'El [[parser|parseo]] convierte cada PDF en texto, página por página, y guarda el número de página para poder citarla después. También calcula un [[hash]] del contenido que sirve como identificador del documento.',
      analogy: 'Como transcribir un documento en papel anotando en qué página estaba cada párrafo.',
      tools: 'Parsers reales: pypdf, Unstructured, Docling o Amazon Textract. El original y el texto extraído se guardan en [[s3]].',
      prod: ['pypdf no hace OCR: un PDF escaneado devuelve texto vacío.', 'Registra qué parser y versión se usó; cambiarlo obliga a volver a indexar.', 'Guarda el texto extraído junto al original para no parsear de nuevo.'] },
    { id: 'chunk', phase: 'index', title: 'Partir en fragmentos', ref: 'Paso 5',
      learn: 'Cómo el tamaño y el traslape de los fragmentos cambian lo que se puede encontrar.',
      io: ['Texto por página', 'Fragmentos con su página'],
      idea: 'Un documento completo es demasiado grande para buscar en él y para dárselo al modelo. Por eso se parte en [[chunk|fragmentos]] de N palabras, con un [[traslape]] para no cortar ideas a la mitad.',
      analogy: 'Como hacer fichas de estudio a partir de un libro: cada ficha trata una sola idea.',
      tools: 'Los modelos miden el texto en [[token|tokens]]. En producción se suele cortar por párrafos o títulos en lugar de cada N palabras.',
      prod: ['En español una palabra equivale a 1.3–1.6 tokens aproximadamente.', 'Cambiar tamaño o traslape cambia todos los fragmentos: requiere un reindexado [[bluegreen|blue-green]].'] },
    { id: 'embed', phase: 'index', title: 'Convertir texto en números', ref: 'Paso -1',
      learn: 'Qué es un embedding, qué es un vector sparse y por qué se guardan los dos.',
      io: ['Fragmento de texto', 'Dos vectores por fragmento'],
      idea: 'Para comparar significados, cada fragmento se convierte en un [[embedding]]: un [[vector]] de números. Textos que dicen lo mismo con otras palabras quedan cerca. Además se guarda un [[sparse|vector sparse]] con las palabras exactas, que usará [[bm25|BM25]].',
      analogy: 'Es como ubicar cada texto en un mapa: los que hablan de lo mismo quedan en el mismo barrio.',
      tools: 'Modelos reales: OpenAI text-embedding-3, BGE-M3 o e5, con cientos o miles de [[dimension|dimensiones]]. El vector sparse lo genera fastembed.',
      prod: ['Envía los textos a la API de embeddings en lotes y con reintentos.', 'Guarda en el [[payload]] qué modelo generó el vector.', 'Si cambias de modelo, los vectores viejos y nuevos no son comparables.'] },
    { id: 'store', phase: 'index', title: 'Dónde se guarda todo', ref: 'Paso 11',
      learn: 'Qué queda guardado en la base de vectores y en el almacén de originales, y para qué sirve el alias.',
      io: ['Vectores + texto + metadata', 'Puntos en Qdrant, archivos en S3'],
      idea: 'Se guarda en dos lugares. El almacén de originales ([[s3]]) guarda el PDF y su texto. La base de vectores ([[qdrant]]) guarda un [[punto]] por fragmento: sus dos vectores y un [[payload]] con el texto y la página. Los puntos viven en una [[coleccion|colección]] (docs_v1) que la aplicación consulta a través de un [[alias]] (docs).',
      analogy: 'El archivero guarda los documentos originales; el fichero de tarjetas es lo que se consulta todos los días.',
      tools: 'Qdrant es open source y puedes correrlo en tu servidor. Alternativas: pgvector, OpenSearch, Weaviate. Para archivos: S3, MinIO o una carpeta.',
      prod: ['IDs de punto deterministas: volver a subir un documento sobrescribe en vez de duplicar.', 'Crea la colección versionada y su [[alias]] desde el primer día.'] },
    { id: 'question', phase: 'query', title: 'La pregunta', ref: 'Paso 12',
      learn: 'Cómo se limpia una pregunta: acentos, palabras vacías y stemming.',
      io: ['Lo que escribes', 'Palabras clave normalizadas'],
      idea: 'Empieza la consulta. Tu pregunta pasa por la misma limpieza que los documentos: minúsculas, sin acentos y con [[stemming|stemming]], para que "vacaciones" y "vacación" coincidan. Elige un ejemplo o escribe la tuya; la puedes cambiar en cualquier paso desde la barra oscura.',
      analogy: 'Como subrayar las palabras importantes de una pregunta antes de buscar.',
      tools: 'En producción aquí también se identifica al usuario y su [[tenant]] para filtrar sus documentos.',
      prod: ['El filtro por cliente sale del usuario autenticado, nunca de lo que envía el navegador.', 'Aplica límites de peticiones por usuario.'] },
    { id: 'qembed', phase: 'query', title: 'La pregunta también se vuelve vector', ref: 'Paso -1',
      learn: 'Cómo la pregunta cae cerca de los fragmentos con significado parecido.',
      io: ['Pregunta', 'Vector de la pregunta'],
      idea: 'La pregunta se convierte en [[embedding]] con el mismo modelo que los documentos. Así cae en el mismo mapa de significados, cerca de los fragmentos que hablan de lo mismo.',
      analogy: 'Ubicar tu pregunta en el mismo mapa para ver qué tiene cerca.',
      tools: 'Debe usarse exactamente el mismo modelo que al indexar: con otro modelo los números no son comparables.',
      prod: ['Si cambias de modelo, cambia el de las preguntas y el de la colección al mismo tiempo (ver el camino avanzado).'] },
    { id: 'dense', phase: 'query', title: 'Búsqueda por significado', ref: 'Paso 6',
      learn: 'Por qué la búsqueda por significado entiende paráfrasis y falla con folios.',
      io: ['Vector de la pregunta', 'Los fragmentos más parecidos'],
      idea: 'La [[densa|búsqueda densa]] trae los fragmentos cuyo vector se parece más al de la pregunta, medido con [[coseno|similitud coseno]]. Entiende sinónimos, pero le cuesta distinguir códigos exactos como un folio.',
      analogy: 'Buscar por tema: encuentra "asueto" aunque el documento diga "vacaciones".',
      tools: 'Con millones de vectores se usa un índice [[hnsw|HNSW]]. En Qdrant esta búsqueda es uno de los dos [[prefetch]] de una sola llamada.',
      prod: ['El filtro por [[tenant]] va dentro de la búsqueda.'] },
    { id: 'bm25', phase: 'query', title: 'Búsqueda por palabras exactas', ref: 'Paso 6',
      learn: 'Por qué las palabras raras pesan más y cómo se calcula BM25.',
      io: ['Palabras de la pregunta', 'Los fragmentos que las contienen'],
      idea: '[[bm25|BM25]] trae los fragmentos que contienen las palabras exactas de la pregunta. Las palabras raras pesan más gracias al [[idf|IDF]]: un folio que aparece una sola vez vale mucho más que "factura".',
      analogy: 'El buscador clásico: si la palabra no está, no la encuentra; si es un código, no se equivoca.',
      tools: 'En Qdrant, BM25 corre sobre el [[sparse|vector sparse]] guardado y es el otro [[prefetch]] de la misma llamada. OpenSearch y Elasticsearch lo traen por defecto.',
      prod: ['Configura el analizador para español (stemming y palabras vacías).'] },
    { id: 'rrf', phase: 'query', title: 'Juntar las dos búsquedas', ref: 'Paso 6',
      learn: 'Cómo se combinan dos rankings sin comparar sus puntajes.',
      io: ['Dos listas ordenadas', 'Una sola lista'],
      idea: 'Ahora hay dos listas: una por significado y otra por palabras. [[rrf|RRF]] las combina en una sola usando solo la posición de cada fragmento en cada lista. Un fragmento que sale arriba en las dos gana.',
      analogy: 'Juntar dos rankings de restaurantes: el que aparece bien calificado en ambos queda primero.',
      tools: 'Qdrant hace esta fusión en el servidor, en la misma llamada que las dos búsquedas.',
      prod: ['k = 60 es el valor típico; revisa qué constante usa tu versión de Qdrant y si permite ajustarla.'] },
    { id: 'rerank', phase: 'query', title: 'El filtro fino (reranking)', ref: 'Paso 6',
      learn: 'Cómo se descartan candidatos y cuándo es mejor decir "no lo sé".',
      io: ['Candidatos de la fusión', 'Los que superan el umbral'],
      idea: 'Un [[rerank|reranker]] lee la pregunta junto con cada candidato y le pone una calificación más precisa. Solo los que superan el [[umbral]] llegan al modelo. Si ninguno lo supera, el sistema dice "no lo sé".',
      analogy: 'La entrevista final: de los currículums preseleccionados solo pasan los que de verdad encajan.',
      tools: 'Rerankers reales: Cohere Rerank o bge-reranker (abierto).',
      prod: ['Calibra el umbral con un [[golden]].', 'Si ningún candidato lo supera, responde "no lo sé" sin llamar al modelo.'] },
    { id: 'generate', phase: 'query', title: 'Generar la respuesta', ref: 'Paso 7',
      learn: 'Cómo se arma el prompt con citas y qué hacer con instrucciones escondidas.',
      io: ['Pregunta + fragmentos elegidos', 'Respuesta con citas'],
      idea: 'El [[llm|modelo]] recibe un [[prompt]] con instrucciones, tu pregunta y los fragmentos numerados. Debe responder solo con eso y poner una [[cita]] en cada afirmación. Si un fragmento trae órdenes escondidas ([[injection|prompt injection]]), se aparta.',
      analogy: 'Pedirle a alguien que responda usando solo las fichas que le diste y que diga de cuál sacó cada dato.',
      tools: 'Aquí el modelo es simulado; en producción sería GPT, Claude o un modelo abierto.',
      prod: ['Delimita el contexto y trátalo como datos, no como instrucciones.', 'El modelo suele ser el costo más alto por consulta.'] },
    { id: 'verify', phase: 'query', title: 'Comprobar las citas', ref: 'Paso 7',
      learn: 'Cómo comprobar que cada cita exista y respalde lo que dice la respuesta.',
      io: ['Respuesta + fragmentos', 'Citas comprobadas'],
      idea: 'Antes de mostrar la respuesta se revisa que cada [[cita]] apunte a un fragmento real y que lo que dice la oración esté en ese fragmento. Así se detectan [[alucinacion|alucinaciones]].',
      analogy: 'Revisar la bibliografía de un trabajo: que cada fuente exista y diga lo que se afirma.',
      tools: 'En producción la tasa de citas inválidas se mide como métrica de calidad, junto con herramientas como Ragas.',
      prod: ['Define qué hacer si falla: reintentar, quitar la oración o marcar baja confianza.'] },
    { id: 'summary', phase: 'close', title: 'Lo que le pasó a tu pregunta', ref: 'Paso 9',
      learn: 'El recorrido completo de tu pregunta y cómo cambia con cada modo de búsqueda.',
      io: ['Todo lo anterior', 'Tu resumen'],
      idea: 'Este es el recorrido completo de tu pregunta, de principio a fin. Abajo puedes comparar qué habría pasado con cada modo de búsqueda sin regresar a ningún paso, y comprobar lo que aprendiste.',
      analogy: '',
      tools: 'Para operar esto en producción sigue el camino avanzado: reindexado sin interrupciones y memoria del índice.',
      prod: ['Mide cualquier cambio con un [[golden]] antes de llevarlo a producción.'] },
  ];
  const stageIdx = id => STAGES.findIndex(s => s.id === id);
  const PHASE_LABEL = { intro: 'Introducción', index: 'Fase 1 · Indexación', query: 'Fase 2 · Consulta', close: 'Cierre' };

  // retos "Experimenta": una acción opcional que cambia el estado y lo que deberías observar
  const setSample = id => { S.query = C.SAMPLE_QUERIES.find(s => s.id === id).q; };
  const CHALLENGES = {
    problem: { task: 'Elige la pregunta del folio y compara: sin RAG el modelo inventa un total; con RAG da el monto real y cita la factura.',
      action: { label: 'Usar la pregunta del folio', run: () => setSample('codigo') },
      expect: 'Sin RAG: un total inventado y sin fuente. Con RAG: "total 48,300.00 MXN" con la cita [1] de la factura F-2024-0117.' },
    docs: { task: 'Apaga la "Política de vacaciones" y después revisa el último paso con la pregunta del asueto.',
      action: { label: 'Apagar la política de vacaciones', run: () => { const d = docByKey(S.docs, 'vacaciones'); if (d) d.enabled = false; if (S.docKey === 'vacaciones') S.docKey = 'vpn'; setSample('parafrasis'); } },
      expect: 'Sin ese documento no hay nada relevante y el sistema responde "no lo sé". Vuelve a activarlo con la casilla "Indexar".' },
    parse: { task: 'Compara el identificador de las dos facturas (F17 y F98).',
      action: { label: 'Ver la factura F-2024-0098', run: () => { S.docKey = 'factura-0098'; } },
      expect: 'Aunque los documentos se parecen mucho, sus identificadores son totalmente distintos: el [[hash]] cambia con cualquier diferencia en el contenido.' },
    chunk: { task: 'Pon el traslape en 0 y busca una frase que quede partida entre dos colores.',
      action: { label: 'Poner el traslape en 0', run: () => { S.cfg.overlap = 0; } },
      expect: 'Sin traslape, una frase del borde queda mitad en un fragmento y mitad en otro. Con traslape, las palabras rayadas aparecen en los dos.' },
    embed: { task: 'Compara "el gato duerme en el sofá" con "la factura vence en mayo".',
      action: { label: 'Probar esa comparación', run: () => { S.simA = 'el gato duerme en el sofá'; S.simB = 'la factura vence en mayo'; } },
      expect: 'La similitud cae cerca de 0 porque no comparten significado. Con "el felino descansa en el mueble" sube aunque no comparten ninguna palabra.' },
    store: { task: 'Toca una fila de la tabla de puntos y encuentra su texto y su página.',
      expect: 'Cada [[punto]] guarda en su [[payload]] el texto del fragmento, la página y el documento. Eso es lo que permite citar "pág. 2" al final.' },
    question: { task: 'Elige la pregunta del folio y mira qué pasa con "F-2024-0117".',
      action: { label: 'Usar la pregunta del folio', run: () => setSample('codigo') },
      expect: 'El folio queda como un solo término, completo; palabras como "de" y "la" se descartan.' },
    qembed: { task: 'Con la pregunta del folio, busca el aviso "Palabras que el modelo no entiende".',
      action: { label: 'Usar la pregunta del folio', run: () => setSample('codigo') },
      expect: 'El folio no tiene significado para el modelo, así que casi no mueve el vector. Por eso la búsqueda por significado no lo distingue.' },
    dense: { task: 'Con la pregunta del folio, compara los puntajes de las dos facturas.',
      action: { label: 'Usar la pregunta del folio', run: () => setSample('codigo') },
      expect: 'Quedan casi empatadas: para la búsqueda por significado, "factura F-2024-0117" y "factura F-2024-0098" dicen casi lo mismo.' },
    bm25: { task: 'Usa la pregunta "¿Cuánto asueto me toca?".',
      action: { label: 'Usar la pregunta del asueto', run: () => setSample('parafrasis') },
      expect: 'BM25 no encuentra nada: ningún documento contiene "asueto". En este caso la búsqueda por significado hace todo el trabajo.' },
    rrf: { task: 'Baja k a 1 y mira cómo cambia la columna "Total".',
      action: { label: 'Poner k = 1', run: () => { S.opts.rrfK = 1; } },
      expect: 'Con k = 1 el primer lugar de cada lista pesa muchísimo más que el segundo. Con k = 60 los totales se parecen más y aparecer en ambas listas es lo que decide.' },
    rerank: { task: 'Usa la pregunta que no está en los documentos (estacionamiento).',
      action: { label: 'Usar la pregunta fuera del corpus', run: () => setSample('fuera') },
      expect: 'Ningún candidato supera el [[umbral]]: el sistema responde "no lo sé" en lugar de inventar.' },
    generate: { task: 'Usa la pregunta "¿Ya se aprobó el pago…?".',
      action: { label: 'Usar la pregunta del pago', run: () => setSample('inyeccion') },
      expect: 'La nota del proveedor queda en cuarentena por traer instrucciones escondidas; la respuesta dice que el pago sigue pendiente de autorización.' },
    verify: { task: 'Activa la alucinación simulada.',
      action: { label: 'Simular una alucinación', run: () => { S.opts.hallucinate = true; } },
      expect: 'Aparece una afirmación con una cita que no existe: la verificación la marca y la respuesta no pasa.' },
    summary: { task: 'Cambia la pregunta desde la barra oscura y mira cómo cambian el recorrido y la comparación de modos.',
      action: { label: 'Cambiar la pregunta', run: () => 'open-q' },
      expect: 'Cada tipo de pregunta favorece un modo distinto. La búsqueda híbrida es la que acierta en más casos, porque combina lo mejor de las dos.' },
  };

  function metric(id) {
    const ix = S.index, t = S.trace;
    const active = S.docs.filter(d => d.enabled);
    switch (id) {
      case 'problem': return 'sin RAG vs con RAG';
      case 'docs': return `${active.length} documentos`;
      case 'parse': return `${active.reduce((a, d) => a + d.pages.length, 0)} páginas`;
      case 'chunk': return `${ix.points.length} fragmentos`;
      case 'embed': return `${ix.dims} números por vector`;
      case 'store': return `${ix.s3.length} archivos · ${ix.points.length} puntos`;
      case 'question': return `${t.queryTerms.length} palabras clave`;
      case 'qembed': { const c = topConcepts(t.qvec)[0]; return c ? 'tema: ' + c.name : 'sin tema reconocido'; }
      case 'dense': return `${t.dense.length} resultados`;
      case 'bm25': return `${t.bm25.length} resultados`;
      case 'rrf': return `${t.fused.length} en una lista`;
      case 'rerank': return S.opts.useRerank ? `${t.final.length} pasan el filtro` : 'desactivado';
      case 'generate': return t.generation.blocked.length ? 'cuarentena: ' + t.generation.blocked.length : (t.generation.answer === E.NO_ANSWER ? '"no lo sé"' : 'respuesta lista');
      case 'verify': return t.verification.noAnswer ? 'sin citas' : (t.verification.ok ? 'citas válidas' : 'revisar citas');
      case 'summary': { const q = L.QUIZZES.query; const ok = q.filter(x => S.quiz[x.id] === x.answer).length; return `${ok}/${q.length} correctas`; }
      default: return '';
    }
  }

  // ================================================================ mapa
  function renderMap() {
    const node = (st, extra) => {
      const i = stageIdx(st.id) + 1;
      const cur = S.stage === st.id ? ' aria-current="step"' : '';
      const cls = ['node', S.visited.has(st.id) ? 'visited' : '', extra || ''].join(' ');
      return `<button class="${cls}" data-stage="${st.id}"${cur}><span class="node-n">${i}</span><span class="node-t">${esc(st.title)}</span><span class="node-m">${esc(metric(st.id))}</span></button>`;
    };
    const idx = STAGES.filter(s => s.phase === 'index');
    const intro = STAGES.filter(s => s.phase === 'intro');
    const close = STAGES.filter(s => s.phase === 'close');
    const q = STAGES.filter(s => s.phase === 'query');
    const io = {
      parse: 'Escribe original y texto extraído en S3',
      store: 'Escribe: upsert de puntos + objetos en S3',
      dense: 'Lee: vector "dense" (índice HNSW)',
      bm25: 'Lee: vector "bm25" (índice invertido) + IDF',
      rrf: 'Fusiona en el servidor y devuelve una lista',
      rerank: 'Lee: payload (texto de cada candidato)',
      generate: 'Lee: payload (texto, fuente, página)',
    }[S.stage] || '';
    const flow = '<div class="flow" aria-hidden="true"></div>';
    const html = `
      <div class="map-phase"><span class="label">Introducción</span>${intro.map(s => node(s)).join(flow)}</div>
      <div class="map-phase"><span class="label">Fase 1 · Indexación</span>${idx.map(s => node(s)).join(flow)}</div>
      <div class="map-phase"><span class="label">Almacenamiento</span>
        <div class="storebox ${io ? 'active' : ''}">
          <button class="db" data-stage="store"><b>S3</b><span>almacén de originales</span><span class="m">${S.index.s3.length} archivos</span></button>
          <button class="db" data-stage="store"><b>Qdrant</b><span>base de vectores · docs → ${esc(S.cfg.name)}</span><span class="m">${S.index.points.length} puntos · ${S.index.dims} dims</span></button>
          <p class="io">${esc(io)}</p>
        </div>
      </div>
      <div class="map-phase"><span class="label">Fase 2 · Consulta</span>
        ${node(q[0])}${flow}${node(q[1])}${flow}
        <div class="qcall"><span class="label">Qdrant · una sola llamada</span>
          <div class="node-pair">${node(q[2], 'dense')}${node(q[3], 'sparse')}</div>${node(q[4])}
        </div>${flow}
        ${q.slice(5).map(s => node(s)).join(flow)}
      </div>
      <div class="map-phase"><span class="label">Cierre</span>${close.map(s => node(s)).join(flow)}</div>`;
    $('#map').innerHTML = html;
    $('#map-sheet').innerHTML = html;
  }

  // ================================================================ componentes
  function topConcepts(v) {
    return E.CONCEPT_NAMES.map((name, i) => ({ name, v: v[i] })).filter(c => c.v > 0.01).sort((a, b) => b.v - a.v);
  }
  function vecStrip(v, model, small) {
    const max = Math.max(...v.map(Math.abs)) || 1;
    return `<div class="vec${small ? ' small' : ''}" role="img" aria-label="Vector de ${v.length} dimensiones">${v.map((x, i) =>
      `<span style="--a:${fx(Math.abs(x) / max, 2)}" title="${esc(E.dimLabel(model, i))}: ${fx(x)}"></span>`).join('')}</div>`;
  }
  function docChips(action) {
    return `<div class="chips" role="group" aria-label="Documento">${S.docs.filter(d => d.enabled).map(d =>
      `<button class="chip" data-action="${action}" data-key="${esc(d.key)}" aria-pressed="${d.key === S.docKey}">${esc(d.short)}<small>${esc(d.title)}</small></button>`).join('')}</div>`;
  }
  function highlight(text, termSet) {
    return text.split(/(\s+)/).map(w => {
      if (/^\s+$/.test(w)) return w;
      const hit = E.terms(w).some(t => termSet.has(t));
      return hit ? `<mark>${esc(w)}</mark>` : esc(w);
    }).join('');
  }
  function resRow(r, o) {
    const p = r.point;
    const bar = o.bar != null ? `<div class="bar"><i class="${o.cls || 'd'}" style="width:${Math.max(2, o.bar * 100)}%"></i></div>` : (o.barHtml || '');
    const snip = o.terms ? highlight(p.payload.text, o.terms) : esc(p.payload.text);
    return `<div class="res${o.below ? ' below' : ''}">
      <span class="rank">#${o.rank != null ? o.rank : r.rank}</span>
      <div class="body"><span class="title">${esc(p.payload.title)} <span class="tag">pág. ${p.payload.page} · chunk ${p.payload.chunk_index}</span> ${o.badge || ''}</span><span class="snip">${snip}</span>${o.extra || ''}</div>
      <div class="score"><span>${o.label}</span>${bar}</div>
    </div>`;
  }
  function scatter(o) {
    if (!S.pca) return '<p class="muted">Se necesitan al menos 3 fragmentos para dibujar el mapa.</p>';
    const [W, H, pad] = isMobile() ? [360, 300, 26] : [640, 340, 34];
    const pts = S.pca.coords;
    const q = o.query ? S.pca.project(o.query) : null;
    const all = q ? pts.concat([q]) : pts;
    const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const sx = x => pad + (x - x0) / ((x1 - x0) || 1) * (W - 2 * pad);
    const sy = y => H - pad - (y - y0) / ((y1 - y0) || 1) * (H - 2 * pad);
    const on = o.highlight || new Set();
    const links = q ? S.index.points.map((p, i) => on.has(p.id) ? `<line class="link" x1="${sx(q[0])}" y1="${sy(q[1])}" x2="${sx(pts[i][0])}" y2="${sy(pts[i][1])}"/>` : '').join('') : '';
    const circles = S.index.points.map((p, i) => {
      const cls = on.has(p.id) ? 'pt on' : (o.docKey && p.docKey === o.docKey ? 'pt doc' : 'pt');
      const r = p.id === S.pointId && o.showSel ? 8 : 6;
      return `<circle class="${cls}" cx="${fx(sx(pts[i][0]), 1)}" cy="${fx(sy(pts[i][1]), 1)}" r="${r}" data-action="pick-point" data-id="${p.id}"><title>${esc(p.payload.title)} · chunk ${p.payload.chunk_index}</title></circle>`;
    }).join('');
    // etiquetas por documento en el centroide de sus puntos
    const groups = {};
    S.index.points.forEach((p, i) => { (groups[p.docKey] = groups[p.docKey] || []).push(pts[i]); });
    const labels = Object.entries(groups).map(([k, g]) => {
      const cx = g.reduce((a, p) => a + p[0], 0) / g.length, cy = g.reduce((a, p) => a + p[1], 0) / g.length;
      return `<text x="${fx(Math.min(W - 30, Math.max(20, sx(cx))), 1)}" y="${fx(Math.max(14, sy(cy) - 12), 1)}" text-anchor="middle">${esc(shortOf(k))}</text>`;
    }).join('');
    const star = q ? `<g transform="translate(${fx(sx(q[0]), 1)} ${fx(sy(q[1]), 1)})"><rect class="q" x="-7" y="-7" width="14" height="14" transform="rotate(45)"/><text y="-14" text-anchor="middle">pregunta</text></g>` : '';
    return `<svg class="scatter" viewBox="0 0 ${W} ${H}" role="img" aria-label="Mapa 2D de los vectores (proyección PCA)">
      <rect class="frame" x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="8"/>${links}${circles}${labels}${star}</svg>`;
  }
  function slider(id, label, min, max, step, value, suffix) {
    return `<div class="field"><label for="${id}">${label}</label><div class="row"><input type="range" id="${id}" data-input="${id}" min="${min}" max="${max}" step="${step}" value="${value}"><output for="${id}">${value}${suffix || ''}</output></div></div>`;
  }
  function qdrantCall() {
    const req = E.qdrantRequest(S.trace, 'acme');
    // JSON compacto: arreglos de números y objetos cortos en una línea; vector denso abreviado
    const fmt = (v, ind) => {
      const pad = '  '.repeat(ind + 1), end = '  '.repeat(ind);
      if (Array.isArray(v) && v.every(x => typeof x !== 'object')) {
        return v.length > 8 ? `[${v.slice(0, 6).join(', ')}, … ${v.length - 6} más]` : JSON.stringify(v).replace(/,/g, ', ');
      }
      const flat = JSON.stringify(v);
      if (typeof v !== 'object' || v === null || flat.length <= 64) return flat.replace(/([,:])(?=["{\[\d])/g, '$1 ');
      if (Array.isArray(v)) return `[\n${v.map(x => pad + fmt(x, ind + 1)).join(',\n')}\n${end}]`;
      return `{\n${Object.entries(v).map(([k, x]) => `${pad}"${k}": ${fmt(x, ind + 1)}`).join(',\n')}\n${end}}`;
    };
    const json = fmt(req, 0);
    const note = S.opts.mode === 'hybrid'
      ? `Los dos <code>prefetch</code> corren dentro de Qdrant (pasos ${stageIdx('dense') + 1} y ${stageIdx('bm25') + 1}) y <code>{"fusion": "rrf"}</code> los fusiona (paso ${stageIdx('rrf') + 1}). El filtro de tenant va en cada prefetch.`
      : `Modo ${esc(modeName(S.opts.mode))}: una sola búsqueda con <code>using: "${S.opts.mode}"</code>, sin fusión.`;
    return `<pre class="code">POST /collections/docs/points/query\n${esc(json)}</pre><p class="panel-note">${note}</p>`;
  }
  // [[clave]] o [[clave|texto]] → botón que abre el glosario
  // dentro de una oración el término se lee natural: sin paréntesis y en minúscula (salvo siglas y Qdrant)
  const inlineTerm = t => {
    t = t.replace(/\s*\(.*\)$/, '');
    return /^Qdrant/.test(t) || /^[A-Z0-9]{2}/.test(t) ? t : t[0].toLowerCase() + t.slice(1);
  };
  const rich = str => esc(str).replace(/\[\[([a-z0-9]+)(?:\|([^\]]+))?\]\]/g, (m, key, label) => {
    const g = L.GLOSSARY[key];
    return g ? `<button type="button" class="term" data-term="${key}">${label || esc(inlineTerm(g.term))}</button>` : (label || key);
  });
  // durante el render de una etapa, los paneles técnicos se mueven a la capa "En la vida real"
  let RCTX = null;
  const REAL_TITLES = new Set(['Salida: objetos en S3', 'Texto extraído (JSON)', 'Qdrant · configuración de la colección', 'Punto seleccionado',
    'La llamada a Qdrant', 'Por qué BM25 vive en Qdrant', 'Límite de cada búsqueda', 'Modelo de embeddings']);
  const qdrantHint = () => {
    const h = `<div class="callout info"><span>Esta búsqueda no es un servicio aparte: es un <code>prefetch</code> de la llamada híbrida a Qdrant.</span><button class="btn small" data-stage="rrf" style="justify-self:start">Ver la llamada completa</button></div>`;
    if (RCTX) { RCTX.push(h); return ''; }
    return h;
  };
  // paneles de detalle: en móvil empiezan plegados para que cada paso quepa sin saturar
  const FOLD_TITLES = new Set(['Agregar un documento', 'Salida: objetos en S3', 'Texto extraído (JSON)', 'Fragmentos resultantes',
    'Qdrant · configuración de la colección', 'Punto seleccionado', 'Peso de cada término (IDF)', 'Por qué BM25 vive en Qdrant',
    'La llamada a Qdrant', 'Vecinos en el mapa', 'Prompt enviado al LLM', 'Comparar los tres modos']);
  const panel = (title, body, aside) => {
    const head = `<span>${title}</span>${aside ? `<span class="muted num panel-aside">${aside}</span>` : ''}`;
    if (RCTX && REAL_TITLES.has(title)) { RCTX.push(`<section class="panel"><h3>${head}</h3>${body}</section>`); return ''; }
    if (isMobile() && FOLD_TITLES.has(title)) {
      return `<details class="panel fold" data-fold="${esc(title)}"${foldOpen(title, false)}><summary><h3>${head}</h3></summary>${body}</details>`;
    }
    return `<section class="panel"><h3>${head}</h3>${body}</section>`;
  };

  // ================================================================ render de etapas
  const R = {};

  R.docs = () => {
    const cards = S.docs.map(d => {
      const info = S.index.documents.find(x => x.key === d.key);
      return `<div class="doc-card ${d.enabled ? '' : 'off'} ${d.key === S.docKey ? 'sel' : ''}">
        <header><h4>${esc(d.title)}</h4><span class="tag">${esc(d.short)}</span></header>
        <div class="meta"><span class="tag">${esc(d.source)}</span><span class="tag">${d.pages.length} pág.</span>${info ? `<span class="tag">${info.chunks} chunks</span>` : ''}${d.untrusted ? '<span class="pill warn">⚠ contiene instrucciones</span>' : ''}${d.custom ? '<span class="pill neutral">agregado por ti</span>' : ''}</div>
        <div class="actions">
          <label class="check"><input type="checkbox" data-action="toggle-doc" data-key="${esc(d.key)}" ${d.enabled ? 'checked' : ''}> Indexar</label>
          <span style="display:flex;gap:6px">${d.custom ? `<button class="btn small danger" data-action="remove-doc" data-key="${esc(d.key)}">Quitar</button>` : ''}<button class="btn small" data-action="view-doc" data-key="${esc(d.key)}" ${d.enabled ? '' : 'disabled'}>Ver parseo</button></span>
        </div></div>`;
    }).join('');
    return panel('Corpus de ejemplo', `<div class="doc-list">${cards}</div>`, `${S.docs.filter(d => d.enabled).length} de ${S.docs.length} activos`) +
      panel('Agregar un documento', `
        <div class="grid-2">
          <div class="field"><label for="new-title">Título</label><input type="text" id="new-title" data-input="new-title" value="${esc(S.newTitle)}"></div>
          <div class="field"><label for="new-text">Texto (separa páginas con una línea en blanco)</label><textarea id="new-text" data-input="new-text" rows="4">${esc(S.newText)}</textarea></div>
        </div>
        <div class="actions" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><button class="btn primary" data-action="add-doc">Agregar e indexar</button><span class="panel-note">Prueba después la pregunta "¿Dónde se estacionan las visitas?" en la etapa Pregunta.</span></div>`);
  };

  R.parse = () => {
    const d = docByKey(S.docs, S.docKey) || S.docs.find(x => x.enabled);
    const info = S.index.documents.find(x => x.key === d.key);
    const s3 = S.index.s3.filter(o => o.key.includes(info.docId));
    const pages = d.pages.map((p, i) => `<div class="paper">${i === 0 ? `<h4>${esc(d.title)}</h4>` : ''}<p>${esc(p)}</p><span class="pg">${esc(d.source)} · pág. ${i + 1}</span></div>`).join('');
    const json = JSON.stringify(s3.find(o => o.body).body, null, 2);
    return docChips('pick-doc') + `<div class="grid-2">
      ${panel('Entrada: PDF', `<div class="paper-stack">${pages}</div>`, `${d.pages.length} páginas`)}
      <div style="display:grid;gap:var(--s-4);align-content:start">
        ${panel('Identidad del documento', `<p class="panel-note">El <code>doc_id</code> es un hash del contenido: dos archivos con el mismo nombre y distinto contenido no se pisan.</p><pre class="code">doc_id  = ${info.docId}   <span class="muted">// hash del contenido (simulado)</span>\nsource  = ${esc(d.source)}</pre>`)}
        ${panel('Salida: objetos en S3', `<div class="table-wrap"><table class="t"><thead><tr><th>Clave</th><th>Contenido</th><th>Tamaño</th></tr></thead><tbody>${s3.map(o => `<tr><td class="mono">${esc(o.key)}</td><td>${esc(o.kind)}</td><td class="n">${bytes(o.bytes)}</td></tr>`).join('')}</tbody></table></div>`)}
        ${panel('Texto extraído (JSON)', `<pre class="code wrap">${esc(json)}</pre>`)}
      </div></div>`;
  };

  R.chunk = () => {
    const d = docByKey(S.docs, S.docKey) || S.docs.find(x => x.enabled);
    const chunks = E.chunkPages(d.pages, S.cfg.size, S.cfg.overlap);
    const sp = selPoint();
    const selIdx = sp && sp.docKey === d.key ? sp.payload.chunk_index : -1;
    const text = d.pages.map((page, pi) => {
      const words = page.split(/\s+/).filter(Boolean);
      const pageChunks = chunks.map((c, i) => Object.assign({ i }, c)).filter(c => c.page === pi + 1);
      const spans = words.map((w, wi) => {
        const cov = pageChunks.filter(c => wi >= c.start && wi < c.end);
        const cls = cov.length > 1 ? 'ov' : 'c' + (cov[0].i % 2);
        const hl = cov.some(c => c.i === selIdx) ? ' hl' : '';
        return `<span class="w ${cls}${hl}" data-action="pick-chunk" data-i="${cov[cov.length - 1].i}">${esc(w)}</span>`;
      }).join(' ');
      return `<span class="pg-sep">página ${pi + 1}</span>${spans}`;
    }).join('');
    const avgWords = chunks.reduce((a, c) => a + (c.end - c.start), 0) / chunks.length;
    const list = chunks.map((c, i) => `<button class="chunk-item ${i === selIdx ? 'sel' : ''}" data-action="pick-chunk" data-i="${i}"><span class="tag">#${i}</span><span><b>pág. ${c.page}</b> · ${c.end - c.start} palabras · ~${Math.round((c.end - c.start) * 1.45)} tokens${c.overlapWords ? ` · ${c.overlapWords} de traslape` : ''}</span><p>${esc(c.text)}</p></button>`).join('');
    return panel('Parámetros', `<div class="controls">
        ${slider('size', 'Tamaño del fragmento (palabras)', 10, 80, 1, S.cfg.size)}
        ${slider('overlap', 'Traslape (palabras)', 0, Math.max(0, S.cfg.size - 1), 1, S.cfg.overlap)}
      </div><p class="panel-note">Con estos valores el corpus completo produce <b>${S.index.points.length}</b> fragmentos. Todas las etapas siguientes, incluida la consulta, ya usan este índice.</p>`) +
      docChips('pick-doc') +
      `<div class="grid-2">${panel(esc(d.title), `<div class="legend"><span><i style="background:var(--dense-soft)"></i>fragmento par</span><span><i style="background:var(--sparse-soft)"></i>fragmento impar</span><span><i style="background:repeating-linear-gradient(135deg,var(--dense-soft) 0 4px,var(--sparse-soft) 4px 8px)"></i>traslape (está en dos fragmentos)</span></div><div class="chunk-text">${text}</div>`, `${chunks.length} fragmentos · ${Math.round(avgWords)} palabras en promedio`)}
      ${panel('Fragmentos resultantes', `<div class="chunk-list">${list}</div>`)}</div>`;
  };

  R.embed = () => {
    const p = selPoint();
    const concepts = p ? topConcepts(p.vector) : [];
    const sim = E.cosine(E.embed(S.simA, S.cfg.model), E.embed(S.simB, S.cfg.model));
    const nC = E.CONCEPT_NAMES.length;
    const sparse = p ? p.sparse.slice().sort((a, b) => b.value - a.value) : [];
    return panel('Modelo de embeddings', `<div class="seg" role="group" aria-label="Modelo">${Object.keys(E.MODELS).map(m => `<button data-action="set-model" data-model="${m}" aria-pressed="${m === S.cfg.model}">${m} · ${E.dimsOf(m)} dims</button>`).join('')}</div>
      <p class="panel-note">En este laboratorio cada vector tiene <b>${nC}</b> dimensiones de "concepto" (grupos de sinónimos escritos a mano) más dimensiones hash. Un modelo real tiene cientos o miles de dimensiones aprendidas y sin nombre. Cambiar de modelo reconstruye el índice completo.</p>`) +
      `<div class="grid-2">
      ${panel('Mapa de significado', `${scatter({ docKey: p && p.docKey, showSel: true })}<p class="panel-note">Proyección 2D (PCA) de los ${S.index.points.length} vectores. Los fragmentos del mismo tema quedan juntos. Haz clic en un punto para inspeccionarlo.</p>`)}
      ${p ? panel('Fragmento seleccionado', `
        <p class="panel-note"><b>${esc(p.payload.title)}</b> · chunk ${p.payload.chunk_index} · pág. ${p.payload.page}</p>
        <p style="font-size:.88rem">${esc(p.payload.text)}</p>
        <span class="label">Vector denso (${p.vector.length} dims)</span>${vecStrip(p.vector, S.cfg.model)}
        <div class="vec-axis"><span>conceptos 0–${nC - 1}</span><span>hash ${nC}–${p.vector.length - 1}</span></div>
        <div class="concepts">${concepts.map(c => `<span class="pill dense">${esc(c.name)} ${fx(c.v, 2)}</span>`).join('') || '<span class="muted">Sin conceptos: solo dimensiones hash</span>'}</div>
        <span class="label">Vector sparse "bm25" (${p.sparse.length} términos · TF saturada; el IDF lo aplica Qdrant)</span>
        <div class="tokens">${sparse.map(s => `<span class="tok stem" title="índice ${s.index}">${esc(s.term)} · ${fx(s.value, 2)}</span>`).join('')}</div>`) : ''}
      </div>` +
      panel('Prueba de similitud', `<div class="grid-2">
        <div class="field"><label for="sim-a">Texto A</label><input type="text" id="sim-a" data-input="sim-a" value="${esc(S.simA)}"></div>
        <div class="field"><label for="sim-b">Texto B</label><input type="text" id="sim-b" data-input="sim-b" value="${esc(S.simB)}"></div></div>
        <div class="meter" id="sim-meter"><span class="sim-val num">${fx(sim, 2)}</span><div class="meter-bar"><i style="width:${Math.max(0, sim) * 100}%"></i></div>
        <p class="panel-note">Similitud coseno entre ambos vectores. Frases con palabras distintas pero significado parecido obtienen un valor alto.</p></div>`);
  };

  R.store = () => {
    const ix = S.index;
    const p = selPoint();
    const obj = S.s3Key ? ix.s3.find(o => o.key === S.s3Key) : null;
    const pointJson = p ? JSON.stringify({
      id: p.id,
      vector: { dense: p.vector.map(x => +fx(x)), bm25: { indices: p.sparse.map(s => s.index), values: p.sparse.map(s => +fx(s.value)) } },
      payload: p.payload,
    }, null, 2) : '';
    const collection = {
      collection_name: ix.name, aliases: ['docs'],
      vectors_config: { dense: { size: ix.dims, distance: 'Cosine' } },
      sparse_vectors_config: { bm25: { modifier: 'idf' } },
      payload_indexes: { doc_id: 'keyword', chunk_index: 'integer', tenant_id: 'keyword (is_tenant)' },
      points_count: ix.points.length,
    };
    const rows = ix.points.map(pt => `<tr class="click ${pt.id === S.pointId ? 'sel' : ''}" data-action="pick-point" data-id="${pt.id}">
      <td class="mono">${pt.id.slice(0, 8)}…</td><td>${esc(shortOf(pt.docKey))}</td><td class="n">${pt.payload.page}</td><td class="n">${pt.payload.chunk_index}</td>
      <td>${vecStrip(pt.vector, S.cfg.model, true)}</td><td class="n">${pt.sparse.length}</td></tr>`).join('');
    return `<div class="grid-2">
      ${panel('Almacén de originales (S3)', `<div class="table-wrap"><table class="t"><thead><tr><th>Clave</th><th>Tamaño</th></tr></thead><tbody>${ix.s3.map(o => `<tr class="click ${o.key === S.s3Key ? 'sel' : ''}" data-action="pick-s3" data-key="${esc(o.key)}"><td class="mono">${esc(o.key)}</td><td class="n">${bytes(o.bytes)}</td></tr>`).join('')}</tbody></table></div>
        ${obj ? (obj.body ? `<pre class="code wrap">${esc(JSON.stringify(obj.body, null, 2))}</pre>` : `<p class="panel-note">Archivo binario (PDF original). Es la fuente de verdad para reindexar si cambia el parser.</p>`) : '<p class="panel-note">Selecciona un objeto para ver su contenido.</p>'}`, `${ix.s3.length} objetos`)}
      <div style="display:grid;gap:var(--s-4);align-content:start">
        ${panel('El alias: el nombre que usa la aplicación', `<div class="table-wrap"><table class="t"><thead><tr><th>Alias</th><th>Apunta a la colección</th></tr></thead><tbody><tr><td class="mono">docs</td><td class="mono">${esc(ix.name)}</td></tr></tbody></table></div><p class="panel-note">La aplicación siempre busca en <code>docs</code>. La ${rich('[[coleccion|colección]]')} real se llama <code>${esc(ix.name)}</code>. Para cambiar de versión se crea otra colección y se mueve el alias; lo practicas en el camino avanzado.</p>`)}
        ${panel('Qdrant · configuración de la colección', `<pre class="code">${esc(JSON.stringify(collection, null, 2))}</pre><p class="panel-note">BM25 no es un índice aparte: es el vector sparse <code>bm25</code> de cada punto, y Qdrant mantiene las estadísticas de IDF de la colección. Memoria de este índice de juguete: ${ix.points.length} × ${ix.dims} dims × 4 B = <b>${bytes(ix.points.length * ix.dims * 4)}</b> en vectores. Calcula uno real en Dimensionamiento.</p>`)}
      </div></div>` +
      `<div class="grid-2">${panel('Base de vectores (Qdrant): un punto por fragmento', `<div class="table-wrap"><table class="t"><thead><tr><th>ID</th><th>Doc</th><th>Pág.</th><th>Chunk</th><th>Vector denso</th><th>Términos sparse</th></tr></thead><tbody>${rows}</tbody></table></div>`, `${ix.points.length} puntos`)}
      ${panel('Punto seleccionado', p ? `<pre class="code">${esc(pointJson)}</pre>` : '<p class="muted">Selecciona un punto.</p>')}</div>` +
      quiz('index');
  };

  // ---------------------------------------------------------------- consulta
  const MODE_LABEL = { hybrid: 'Híbrida', dense: 'Solo significado', bm25: 'Solo palabras' };
  function answerHtml(t) {
    const g = t.generation;
    return g.parts.length
      ? g.parts.map(p => `${esc(p.text)} <span class="cite ${p.cite > t.final.length ? 'bad' : ''}">${p.cite}</span>.`).join(' ')
      : esc(g.answer);
  }
  function verdictPill(t) {
    if (t.verification.noAnswer) return '<span class="pill neutral">responde "no lo sé"</span>';
    return t.verification.ok ? '<span class="pill good">✓ citas válidas</span>' : '<span class="pill bad">✗ citas por revisar</span>';
  }
  // barra de la consulta: pregunta, modo y rerank disponibles en cada paso, sin regresar
  function searchBar() {
    const t = S.trace;
    const quarantine = t.generation.blocked.length ? '<span class="pill warn">⚠ fragmento en cuarentena</span>' : '';
    return `<div class="qstrip sbar">
      <div class="sbar-top"><span class="label">Tu pregunta</span><button class="btn small on-dark" data-action="open-q">Cambiar pregunta</button></div>
      <q>${esc(S.query)}</q>
      <div class="sbar-ctrl">
        <div class="seg on-dark" role="group" aria-label="Modo de búsqueda">${['hybrid', 'dense', 'bm25'].map(m => `<button data-action="mode" data-mode="${m}" aria-pressed="${S.opts.mode === m}">${MODE_LABEL[m]}</button>`).join('')}</div>
        <label class="check on-dark"><input type="checkbox" data-action="toggle-rerank" ${S.opts.useRerank ? 'checked' : ''}> Filtro fino (rerank)</label>
      </div>
      <span class="ans">${esc(t.generation.answer.slice(0, 160))}${t.generation.answer.length > 160 ? '…' : ''} ${verdictPill(t)} ${quarantine}</span>
    </div>`;
  }
  // misma pregunta y ajustes con los tres modos de búsqueda, lado a lado
  function compareModes(title) {
    const cards = ['hybrid', 'dense', 'bm25'].map(m => {
      const t = E.runQuery(S.index, S.query, Object.assign({}, S.opts, { mode: m, hallucinate: false }));
      const top = (t.final.length ? t.final : []).map(r => `<li>${esc(r.point.payload.title)} <span class="tag">pág. ${r.point.payload.page}</span></li>`).join('');
      const cur = m === S.opts.mode;
      return `<article class="cmp ${cur ? 'cur' : ''}">
        <header><b>${MODE_LABEL[m]}</b>${cur ? '<span class="pill neutral">modo actual</span>' : `<button class="btn small" data-action="mode" data-mode="${m}">Usar este modo</button>`}</header>
        <span class="label">Llegan al modelo</span>${top ? `<ol>${top}</ol>` : '<p class="muted">Ningún fragmento</p>'}
        <span class="label">Respuesta</span><p>${esc(t.generation.answer.slice(0, 170))}${t.generation.answer.length > 170 ? '…' : ''}</p>${verdictPill(t)}
      </article>`;
    }).join('');
    return panel(title, `<p class="panel-note">Misma pregunta y mismos ajustes; solo cambia cómo se busca.</p><div class="cmp-grid">${cards}</div>`);
  }
  // comprobación de fase: opciones, respuesta explicada y puntaje guardado en el dispositivo
  function quiz(set) {
    const qs = L.QUIZZES[set];
    const done = qs.filter(q => S.quiz[q.id] != null);
    const ok = done.filter(q => S.quiz[q.id] === q.answer).length;
    const items = qs.map(q => {
      const a = S.quiz[q.id];
      const opts = q.options.map((o, i) => {
        const cls = a == null ? '' : (i === q.answer ? 'right' : (i === a ? 'wrong' : ''));
        return `<button class="qopt ${cls}" data-action="quiz" data-q="${q.id}" data-i="${i}" ${a != null ? 'disabled' : ''}>${esc(o)}</button>`;
      }).join('');
      const why = a != null ? `<p class="qwhy ${a === q.answer ? 'good' : 'bad'}"><b>${a === q.answer ? 'Correcto.' : 'No exactamente.'}</b> ${esc(q.why)}</p>` : '';
      return `<div class="qitem"><p class="qq">${esc(q.q)}</p><div class="qopts">${opts}</div>${why}</div>`;
    }).join('');
    const foot = `<div class="qfoot"><span>${ok} de ${qs.length} correctas</span>${done.length ? `<button class="btn small" data-action="quiz-reset" data-set="${set}">Intentar de nuevo</button>` : ''}</div>`;
    return `<section class="panel quiz"><h3><span>Comprueba lo que aprendiste</span><span class="muted num panel-aside">${done.length}/${qs.length}</span></h3>${items}${foot}</section>`;
  }

  R.problem = () => {
    const sample = C.SAMPLE_QUERIES.find(x => x.q === S.query);
    const noRag = L.NO_RAG[sample ? sample.id : 'otra'];
    const t = S.trace;
    const sources = t.final.map((r, i) => `<li><span class="cite">${i + 1}</span> ${esc(r.point.payload.title)} · pág. ${r.point.payload.page}</li>`).join('');
    return `<div class="chips" role="group" aria-label="Pregunta de ejemplo">${C.SAMPLE_QUERIES.map(x => `<button class="chip" data-action="sample" data-id="${x.id}" aria-pressed="${x.q === S.query}">${esc(x.label)}<small>${esc(x.q)}</small></button>`).join('')}</div>
      <div class="vs">
        <section class="panel vs-card bad"><h3>Sin RAG</h3><p class="panel-note">El modelo responde solo con lo que aprendió en su entrenamiento.</p><p class="answer">${esc(noRag)}</p><span class="pill bad">✗ sin fuente: no se puede comprobar</span></section>
        <section class="panel vs-card good"><h3>Con RAG</h3><p class="panel-note">Primero busca en los documentos y responde solo con lo que encontró.</p><p class="answer">${answerHtml(t)}</p>${sources ? `<ul class="src">${sources}</ul>` : ''}${verdictPill(t)}</section>
      </div>
      <div class="callout info"><span>Los siguientes pasos explican cómo se construye la respuesta de la derecha: primero se preparan los documentos (fase 1) y después se responde la pregunta (fase 2).</span></div>`;
  };

  R.summary = () => {
    const t = S.trace, o = S.opts;
    const docs = list => list.slice(0, 3).map(r => `${r.point.payload.title} (pág. ${r.point.payload.page})`).join(' · ') || 'nada';
    const cs = topConcepts(t.qvec).slice(0, 3).map(c => c.name).join(', ');
    const steps = [
      ['question', 'Palabras clave', t.queryTerms.join(', ') || 'ninguna'],
      ['qembed', 'Tema detectado', cs || 'ninguno reconocido'],
      ['dense', 'Búsqueda por significado', o.mode === 'bm25' ? 'no se ejecutó en este modo' : docs(t.dense)],
      ['bm25', 'Búsqueda por palabras', o.mode === 'dense' ? 'no se ejecutó en este modo' : docs(t.bm25)],
      ['rrf', 'Una sola lista', docs(t.fused)],
      ['rerank', 'Filtro fino', o.useRerank ? `${t.final.length} de ${t.reranked.length} superaron el umbral (${o.threshold})` : `desactivado: pasan los primeros ${o.topK}`],
      ['generate', 'Respuesta', t.generation.answer.slice(0, 160) + (t.generation.blocked.length ? ' (un fragmento quedó en cuarentena)' : '')],
      ['verify', 'Citas', t.verification.noAnswer ? 'sin afirmaciones que comprobar' : (t.verification.ok ? 'todas válidas' : 'hay citas inválidas')],
    ];
    const tl = `<ol class="timeline">${steps.map(([id, label, text]) => `<li><button class="tl-item" data-stage="${id}"><span class="tl-n">${stageIdx(id) + 1}</span><span class="tl-body"><b>${label}</b><span>${esc(text)}</span></span></button></li>`).join('')}</ol>`;
    return panel(`Así viajó «${esc(S.query)}»`, tl + '<p class="panel-note">Toca cualquier paso para verlo en detalle.</p>') +
      compareModes('Así habría respondido cada modo') +
      quiz('query') +
      panel('¿Qué sigue?', `<div class="next">
        <a class="btn" href="#advanced">Camino avanzado: operar en producción →</a>
        <a class="btn" href="#glossary">Repasar el glosario</a>
        <a class="btn ghost" href="#docs">Leer la guía técnica</a></div>`);
  };

  const modeName = m => MODE_LABEL[m].toLowerCase();

  R.question = () => {
    const raw = E.rawTokens(S.query);
    const sample = C.SAMPLE_QUERIES.find(s => s.q === S.query);
    return panel('Tu pregunta', `
      <form class="field" data-form="ask"><label for="q-input">Pregunta</label>
        <div class="row"><input type="text" id="q-input" value="${esc(S.query)}" autocomplete="off"><button class="btn primary" type="submit">Preguntar</button></div></form>
      <span class="label">Ejemplos</span>
      <div class="chips">${C.SAMPLE_QUERIES.map(s => `<button class="chip" data-action="sample" data-id="${s.id}" aria-pressed="${s.q === S.query}">${esc(s.label)}<small>${esc(s.q)}</small></button>`).join('')}</div>
      ${sample ? `<div class="callout info"><b>Qué observar</b><span>${esc(sample.hint)}</span></div>` : ''}`) +
      panel('Normalización', `<div class="arrow-row">
        <span class="label">1 · Tokens (minúsculas, sin acentos)</span><div class="tokens">${raw.map(t => `<span class="tok ${E.terms(t).length ? '' : 'stop'}">${esc(t)}</span>`).join('')}</div>
        <span class="label">2 · Términos sin palabras vacías y con stemming</span><div class="tokens">${S.trace.queryTerms.map(t => `<span class="tok stem">${esc(t)}</span>`).join('') || '<span class="muted">Ningún término útil</span>'}</div>
      </div><p class="panel-note">Las palabras tachadas son palabras vacías. El stemming unifica singular y plural ("vacaciones" y "vacación" quedan como <code>${esc(E.stem('vacaciones'))}</code>). Los folios como <code>f-2024-0117</code> se conservan completos.</p>`);
  };

  R.qembed = () => {
    const t = S.trace;
    const cs = topConcepts(t.qvec);
    const unknown = [...new Set(t.queryTerms)].filter(term => !E.embed(term, 'mock-embed-small').slice(0, E.CONCEPT_NAMES.length).some(x => x > 0));
    return `<div class="grid-2">
      ${panel('Vector de la pregunta', `${vecStrip(t.qvec, t.model)}<div class="vec-axis"><span>conceptos</span><span>hash</span></div>
        <span class="label">Conceptos activados</span><div class="concepts">${cs.map(c => `<span class="pill dense">${esc(c.name)} ${fx(c.v, 2)}</span>`).join('') || '<span class="muted">Ninguno</span>'}</div>
        ${unknown.length ? `<div class="callout warn"><b>Palabras que el modelo no entiende</b><span>${unknown.map(u => `<code>${esc(u)}</code>`).join(' ')} no tienen significado para el modelo y casi no mueven el vector. La búsqueda por significado no las distingue; BM25 sí las encuentra si aparecen tal cual.</span></div>` : ''}`)}
      ${panel('La pregunta en el mapa', `${scatter({ query: t.qvec, highlight: new Set(t.dense.slice(0, 3).map(r => r.point.id)) })}<p class="panel-note">El rombo es la pregunta, proyectada en el mismo plano que los fragmentos. Los puntos resaltados son los 3 más cercanos por coseno (en el espacio completo, no en esta proyección 2D).</p>`)}
    </div>`;
  };

  R.dense = () => {
    const t = S.trace;
    const off = S.opts.mode === 'bm25' ? '<div class="callout warn">El modo actual es "solo palabras": la búsqueda por significado no se ejecuta. Cambia el modo en la barra oscura de arriba.</div>' : '';
    const max = t.dense.length ? t.dense[0].score : 1;
    return off + qdrantHint() + panel('Límite de cada búsqueda', slider('cand', 'Candidatos por búsqueda (N)', 3, 15, 1, S.opts.candidates)) +
      `<div class="grid-2">${panel('Resultados por similitud coseno', `<div class="results">${t.dense.map(r => resRow(r, { label: 'cos ' + fx(r.score), bar: Math.max(0, r.score) / (max || 1), cls: 'd' })).join('') || '<p class="muted">Sin resultados.</p>'}</div>`, `top ${t.dense.length}`)}
      ${panel('Vecinos en el mapa', scatter({ query: t.qvec, highlight: new Set(t.dense.slice(0, 5).map(r => r.point.id)) }) + '<p class="panel-note">Líneas: los 5 vecinos más cercanos de la pregunta.</p>')}</div>`;
  };

  R.bm25 = () => {
    const t = S.trace;
    const off = S.opts.mode === 'dense' ? '<div class="callout warn">El modo actual es "solo significado": BM25 no se ejecuta. Cambia el modo en la barra oscura de arriba.</div>' : '';
    const uniq = [...new Set(t.queryTerms)];
    const idfRows = uniq.map(term => {
      const df = S.index.bm25.df.get(term) || 0;
      return `<tr class="${df ? '' : 'dim'}"><td class="mono">${esc(term)}</td><td class="n">${df}</td><td class="n">${fx(E.termIdf(S.index, term), 2)}</td><td>${df ? '' : 'no aparece en el corpus'}</td></tr>`;
    }).join('');
    const max = t.bm25.length ? t.bm25[0].score : 1;
    const termSet = new Set(uniq);
    return off + qdrantHint() + `<div class="grid-2">
      ${panel('Resultados BM25', `<div class="results">${t.bm25.map(r => resRow(r, {
        label: 'bm25 ' + fx(r.score, 2), bar: r.score / max, cls: 's', terms: termSet,
        extra: `<span class="tokens">${r.matched.map(m => `<span class="tok stem">${esc(m.term)}: ${fx(m.idf, 2)} × ${fx(m.value, 2)}</span>`).join('')}</span>`,
      })).join('') || '<div class="callout warn">Ningún fragmento contiene los términos exactos de la pregunta. Aquí BM25 no aporta nada y la búsqueda densa hace todo el trabajo.</div>'}</div>`, `top ${t.bm25.length}`)}
      ${panel('Peso de cada término (IDF)', `<div class="table-wrap"><table class="t"><thead><tr><th>Término</th><th>df</th><th>IDF</th><th></th></tr></thead><tbody>${idfRows}</tbody></table></div>
        <p class="panel-note"><code>df</code> = en cuántos de los ${S.index.bm25.N} fragmentos aparece. Qdrant lo mantiene y calcula IDF = ln(1 + (N − df + 0.5)/(df + 0.5)) al consultar. El vector sparse guardó la TF saturada (k1 = ${S.index.bm25.k1}, b = ${S.index.bm25.b}, longitud promedio fija = ${S.index.bm25.avgLen} términos). Score = Σ IDF × TF; cada chip muestra IDF × TF.</p>`)}
    </div>` + panel('Por qué BM25 vive en Qdrant', `<div class="table-wrap"><table class="t"><thead><tr><th></th><th>rank_bm25 en memoria</th><th>Sparse BM25 en Qdrant</th></tr></thead><tbody>
      <tr><td>Escala</td><td>Todo el corpus en la RAM de cada réplica</td><td>Índice invertido persistente</td></tr>
      <tr><td>Documento nuevo</td><td>Reconstruir el índice completo</td><td>Un upsert; Qdrant actualiza el IDF</td></tr>
      <tr><td>Consistencia con el denso</td><td>Otro índice que sincronizar</td><td>Mismo punto, mismo ID</td></tr>
      <tr><td>Blue-green</td><td>Versionarlo por separado</td><td>Cambia con el alias</td></tr>
      <tr><td>Fusión</td><td>En tu código</td><td>En el servidor, misma llamada</td></tr>
      </tbody></table></div><p class="panel-note">Recomendación de la guía: sparse BM25 en Qdrant. OpenSearch solo si ya lo operas o necesitas análisis lingüístico avanzado.</p>`);
  };

  R.rrf = () => {
    const t = S.trace, k = S.opts.rrfK;
    const max = t.fused.length ? t.fused[0].score : 1;
    const rows = t.fused.map(r => {
      const d = r.parts.dense, s = r.parts.bm25;
      return `<tr><td class="n">${r.rank}</td><td>${esc(r.point.payload.title)} <span class="tag">chunk ${r.point.payload.chunk_index}</span></td>
        <td class="n">${d ? '#' + d.rank : '—'}</td><td class="n">${d ? fx(d.contrib, 4) : '—'}</td>
        <td class="n">${s ? '#' + s.rank : '—'}</td><td class="n">${s ? fx(s.contrib, 4) : '—'}</td>
        <td class="n"><b>${fx(r.score, 4)}</b></td>
        <td style="min-width:120px"><div class="bar" role="img" aria-label="densa ${d ? fx(d.contrib, 4) : 0}, BM25 ${s ? fx(s.contrib, 4) : 0}">${d ? `<i class="d" style="width:${d.contrib / max * 100}%"></i>` : ''}${s ? `<i class="s" style="width:${s.contrib / max * 100}%"></i>` : ''}</div></td></tr>`;
    }).join('');
    const top = t.fused[0];
    const example = top ? Object.entries(top.parts).map(([n, p]) => `1/(${k} + ${p.rank})`).join(' + ') + ` = ${fx(top.score, 4)}` : '';
    return panel('La llamada a Qdrant', qdrantCall()) +
      panel('Constante k', `${slider('rrfk', 'k de RRF', 1, 100, 1, k)}<p class="panel-note">Con k bajo, el primer lugar de cada lista pesa mucho más que el resto. Con k alto, aparecer en ambas listas importa más que la posición exacta.${example ? ` Primer lugar: <code>${esc(example)}</code>.` : ''} El control es para experimentar: en producción la constante la aplica Qdrant.</p>`) +
      panel('Lista fusionada', `<div class="legend"><span><i style="background:var(--dense)"></i>aporte de la búsqueda densa</span><span><i style="background:var(--sparse)"></i>aporte de BM25</span></div>
        <div class="table-wrap"><table class="t"><thead><tr><th>#</th><th>Fragmento</th><th>Pos. significado</th><th>Aporte</th><th>Pos. BM25</th><th>Aporte</th><th>Total</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`, `${t.fused.length} candidatos`) +
      compareModes('Comparar los tres modos');
  };

  R.rerank = () => {
    const t = S.trace, o = S.opts;
    const ctrl = panel('Parámetros', `<div class="controls">
      <label class="check"><input type="checkbox" data-action="toggle-rerank" ${o.useRerank ? 'checked' : ''}> Reranking activo</label>
      ${slider('thr', 'Umbral mínimo de relevancia', 0, 0.95, 0.05, o.threshold)}
      ${slider('topk', 'Fragmentos que llegan al LLM (K)', 1, 5, 1, o.topK)}
    </div>`);
    if (!o.useRerank) {
      return ctrl + panel('Sin reranking', `<div class="callout warn">Los ${o.topK} primeros de RRF pasan directo al LLM, sin umbral. Una pregunta fuera del corpus igual recibe contexto y el LLM puede inventar a partir de él.</div><div class="results">${t.final.map(r => resRow(r, { label: 'RRF ' + fx(r.score, 4) })).join('')}</div>`);
    }
    const before = t.fused.map(r => r.point.id);
    const finalIds = new Set(t.final.map(r => r.point.id));
    const rows = t.reranked.map(r => {
      const was = before.indexOf(r.point.id) + 1;
      const mv = was - r.rank;
      const move = mv > 0 ? `<span class="move up">▲${mv}</span>` : mv < 0 ? `<span class="move down">▼${-mv}</span>` : '<span class="move muted">=</span>';
      const c = r.components;
      return resRow(r, {
        label: `${fx(r.rerankScore, 2)} ${finalIds.has(r.point.id) ? '<span class="pill good">al LLM</span>' : (r.rerankScore < o.threshold ? '<span class="pill neutral">bajo umbral</span>' : '<span class="pill neutral">fuera de K</span>')}`,
        barHtml: `<div class="bar threshold" style="background:linear-gradient(90deg,transparent calc(${o.threshold * 100}% - 1px),var(--ink) calc(${o.threshold * 100}% - 1px) calc(${o.threshold * 100}% + 1px),transparent 0),var(--surface-2)"><i class="a" style="width:${Math.max(2, r.rerankScore * 100)}%"></i></div>`,
        below: !finalIds.has(r.point.id),
        badge: `${move} <span class="muted" style="font-size:.74rem">antes #${was}</span>`,
        extra: `<span class="tokens"><span class="tok concept">semántica ${pct(c.semantic)}</span><span class="tok stem">léxica ${pct(c.coverage)}</span><span class="tok">frase ${pct(c.phrase)}</span></span>`,
      });
    }).join('');
    const none = !t.final.length ? '<div class="callout good"><b>Ningún candidato supera el umbral</b><span>El sistema responderá "no lo sé" sin llamar al LLM. Esto ahorra costo y evita respuestas inventadas.</span></div>' : '';
    return ctrl + none + panel('Nuevo orden', `<p class="panel-note">Score simulado del cross-encoder: combina cobertura semántica de la pregunta, cobertura léxica ponderada por IDF y frases que coinciden. La línea vertical de cada barra marca el umbral.</p><div class="results">${rows}</div>`, `${t.final.length} de ${t.reranked.length} pasan`);
  };

  R.generate = () => {
    const t = S.trace, g = t.generation;
    const blocked = g.blocked.map(b => `<div class="callout warn"><b>⚠ Fragmento [${b.n}] en cuarentena · ${esc(b.source)}</b><span>Contiene una instrucción dirigida al modelo: «${esc(b.text)}». Se excluye del contexto útil y no se obedece.</span></div>`).join('');
    const answer = answerHtml(t);
    const sources = t.final.map((r, i) => `<tr><td class="n">[${i + 1}]</td><td>${esc(r.point.payload.source)}</td><td class="n">${r.point.payload.page}</td><td class="n">${r.point.payload.chunk_index}</td></tr>`).join('');
    return panel('Simulación', `<label class="check"><input type="checkbox" data-action="toggle-halluc" ${S.opts.hallucinate ? 'checked' : ''}> Simular una alucinación (el LLM agrega una afirmación con una cita que no existe)</label>`) +
      blocked +
      `<div class="grid-2">
      ${panel('Respuesta', `<p class="answer">${answer}</p>${sources ? `<div class="table-wrap"><table class="t"><thead><tr><th>Cita</th><th>Fuente</th><th>Pág.</th><th>Chunk</th></tr></thead><tbody>${sources}</tbody></table></div>` : ''}`)}
      ${panel('Prompt enviado al LLM', `<span class="label">System</span><pre class="code wrap">${esc(E.SYSTEM_PROMPT)}</pre><span class="label">User</span><pre class="code wrap">${esc(g.prompt)}</pre>`)}
      </div>` + compareModes('Comparar los tres modos');
  };

  R.verify = () => {
    const v = S.trace.verification;
    const label = { 'respaldada': ['good', '✓ respaldada'], 'no-respaldada': ['bad', '✗ no respaldada'], 'cita-inexistente': ['bad', '✗ cita inexistente'], 'sin-cita': ['warn', '⚠ sin cita'] };
    if (v.noAnswer) return panel('Resultado', '<div class="callout good"><b>Respuesta "no lo sé"</b><span>No hay afirmaciones que verificar. Es la respuesta correcta cuando el contexto no cubre la pregunta.</span></div>');
    const rows = v.checks.map(c => `<tr><td>${esc(c.claim)}</td><td class="n">${c.cite != null ? '[' + c.cite + ']' : '—'}</td><td class="n">${c.support != null ? pct(c.support) : '—'}</td><td><span class="pill ${label[c.status][0]}">${label[c.status][1]}</span></td></tr>`).join('');
    const verdict = v.ok
      ? '<div class="callout good"><b>✓ Todas las citas son válidas</b><span>Cada afirmación cita un fragmento existente y comparte al menos 60% de sus términos con él.</span></div>'
      : '<div class="callout bad"><b>✗ La respuesta no pasa la verificación</b><span>Hay citas a fragmentos que no existen o afirmaciones sin respaldo. Política sugerida: quitar esas oraciones o reintentar la generación.</span></div>';
    return verdict + panel('Chequeo por afirmación', `<div class="table-wrap"><table class="t"><thead><tr><th>Afirmación</th><th>Cita</th><th>Respaldo</th><th>Estado</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="panel-note">"Respaldo" es la fracción de términos de la afirmación que aparecen en el fragmento citado. Activa la alucinación simulada en la etapa Generación para ver una cita inválida.</p>`);
  };

  function renderStage() {
    const st = STAGES[stageIdx(S.stage)];
    const i = stageIdx(st.id);
    const prev = STAGES[i - 1], next = STAGES[i + 1];
    const real = [];
    let body;
    RCTX = real;
    try { body = R[st.id](); } catch (err) { body = `<div class="callout bad"><b>No se pudo calcular esta etapa</b><span>${esc(err.message)}</span></div>`; }
    RCTX = null;
    const ch = CHALLENGES[st.id];
    const withBar = st.phase === 'query' || st.phase === 'close';
    const tryLayer = ch ? `<section class="layer layer-try"><span class="layer-tag">Experimenta</span>
        <p>${rich(ch.task)}</p>
        ${ch.action ? `<button class="btn primary small" data-action="challenge">${esc(ch.action.label)}</button>` : ''}
        <details class="expect" data-fold="exp-${st.id}"${foldOpen('exp-' + st.id, false)}><summary>Qué deberías ver</summary><p>${rich(ch.expect)}</p></details>
      </section>` : '';
    $('#stage').innerHTML = `
      <div class="stage-top">
        <button class="steps-btn" data-action="open-steps" aria-haspopup="dialog">Paso ${i + 1} de ${STAGES.length} <span aria-hidden="true">▾</span></button>
        <div class="progress" role="progressbar" aria-label="Avance del recorrido" aria-valuemin="1" aria-valuemax="${STAGES.length}" aria-valuenow="${i + 1}"><i style="width:${(i + 1) / STAGES.length * 100}%"></i></div>
        <span class="swipe-hint">Desliza ← → · toca lo subrayado</span>
      </div>
      <header class="stage-head">
        <p class="eyebrow">Paso ${i + 1} · ${PHASE_LABEL[st.phase]}</p>
        <h2>${esc(st.title)}</h2>
      </header>
      <section class="layer layer-idea"><span class="layer-tag">La idea</span>
        <p class="lede">${rich(st.idea)}</p>
        ${st.analogy ? `<p class="analogy"><b>Piénsalo así:</b> ${esc(st.analogy)}</p>` : ''}
        <div class="io-row"><span><b>Entra</b>${esc(st.io[0])}</span><span><b>Sale</b>${esc(st.io[1])}</span></div>
      </section>
      ${withBar ? searchBar() : ''}
      <section class="layer layer-see"><span class="layer-tag">Míralo</span>${body}</section>
      ${tryLayer}
      <details class="layer layer-real" data-fold="real"${foldOpen('real', false)}>
        <summary><span class="layer-tag">En la vida real</span><span class="muted">herramientas, código y producción</span></summary>
        <p>${rich(st.tools)}</p>
        ${real.join('')}
        <h3>En producción</h3><ul>${st.prod.map(x => `<li>${rich(x)}</li>`).join('')}</ul>
        <button class="btn small" data-doc-ref="${esc(st.ref)}">Leer en la guía técnica: ${esc(st.ref)}</button>
      </details>
      <nav class="stepper" aria-label="Navegación entre pasos">
        <button class="btn" data-stage="${prev ? prev.id : ''}" ${prev ? '' : 'disabled'} aria-label="Paso anterior${prev ? ': ' + esc(prev.title) : ''}"><span class="ellip">← ${prev ? esc(prev.title) : 'Inicio'}</span></button>
        <button class="btn primary" data-stage="${next ? next.id : ''}" ${next ? '' : 'disabled'} aria-label="Paso siguiente${next ? ': ' + esc(next.title) : ''}"><span class="ellip">${next ? esc(next.title) : 'Fin del recorrido'}</span> →</button>
      </nav>`;
  }
  function renderLab() {
    renderMap();
    renderStage();
    $('#view-lab').classList.toggle('at-start', S.stage === STAGES[0].id);
    persist();
  }
  function goStage(id, keepPlaying) {
    if (!id) return;
    if (!keepPlaying) stopPlay();
    S.stage = id;
    S.visited.add(id);
    const sheet = $('#step-sheet');
    if (sheet.open) sheet.close();
    renderLab();
    if (isMobile()) { window.scrollTo(0, 0); return; }
    const top = $('#stage').getBoundingClientRect().top;
    if (top < 60 || top > window.innerHeight * 0.6) window.scrollTo({ top: window.scrollY + top - 90, behavior: 'smooth' });
  }

  // gesto de deslizar entre pasos (fuera de controles y zonas con scroll propio)
  (function swipe() {
    const el = $('#stage');
    let sx = 0, sy = 0, t0 = 0, skip = true;
    el.addEventListener('touchstart', e => {
      const t = e.touches[0];
      skip = e.touches.length > 1 || !!e.target.closest('input, textarea, select, pre, .table-wrap, svg, .chips, .tokens, .seg, .chunk-text');
      sx = t.clientX; sy = t.clientY; t0 = Date.now();
    }, { passive: true });
    el.addEventListener('touchend', e => {
      if (skip || !isMobile()) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.abs(dx) < 70 || Math.abs(dy) > 45 || Date.now() - t0 > 700) return;
      const i = stageIdx(S.stage) + (dx < 0 ? 1 : -1);
      if (STAGES[i]) goStage(STAGES[i].id);
    }, { passive: true });
  })();

  // ---------------------------------------------------------------- reproducción
  let playTimer = null;
  function stopPlay() {
    if (playTimer) { clearInterval(playTimer); playTimer = null; }
    const b = $('#play-btn');
    if (b) b.textContent = 'Reproducir recorrido';
  }
  function togglePlay() {
    if (playTimer) return stopPlay();
    if (stageIdx(S.stage) >= STAGES.length - 1) goStage(STAGES[0].id, true);
    $('#play-btn').textContent = 'Pausar';
    playTimer = setInterval(() => {
      const i = stageIdx(S.stage);
      if (i >= STAGES.length - 1) return stopPlay();
      goStage(STAGES[i + 1].id, true);
    }, 3500);
  }

  // ---------------------------------------------------------------- eventos del laboratorio
  function onLabInput(id, el) {
    const v = el.value;
    switch (id) {
      case 'size': S.cfg.size = +v; if (S.cfg.overlap >= S.cfg.size) S.cfg.overlap = S.cfg.size - 1; return 'rebuild';
      case 'overlap': S.cfg.overlap = +v; return 'rebuild';
      case 'cand': S.opts.candidates = +v; return 'rerun';
      case 'rrfk': S.opts.rrfK = +v; return 'rerun';
      case 'thr': S.opts.threshold = +v; return 'rerun';
      case 'topk': S.opts.topK = +v; return 'rerun';
      case 'sim-a': S.simA = v; return 'sim';
      case 'sim-b': S.simB = v; return 'sim';
      case 'new-title': S.newTitle = v; return null;
      case 'new-text': S.newText = v; return null;
      default: return null;
    }
  }
  function labInput(el) {
    const what = onLabInput(el.dataset.input, el);
    if (what === 'sim') {
      const sim = E.cosine(E.embed(S.simA, S.cfg.model), E.embed(S.simB, S.cfg.model));
      const m = $('#sim-meter');
      if (m) { m.querySelector('.sim-val').textContent = fx(sim, 2); m.querySelector('.meter-bar i').style.width = Math.max(0, sim) * 100 + '%'; }
      return;
    }
    if (!what) return;
    if (what === 'rebuild') rebuild(); else rerun();
    renderLab();
    const again = document.getElementById(el.id);
    if (again) again.focus();
  }

  document.addEventListener('submit', e => {
    const f = e.target.closest('[data-form="ask"]');
    if (!f) return;
    e.preventDefault();
    const q = f.querySelector('input').value.trim();
    if (!q) { toast('Escribe una pregunta'); return; }
    S.query = q;
    const qs = $('#q-sheet'); if (qs.open) qs.close();
    rerun();
    renderLab();
    toast('Pregunta recalculada en todas las etapas');
  });

  function labAction(a, el) {
    switch (a) {
      case 'play': togglePlay(); return;
      case 'open-q': openQSheet(); return;
      case 'close-q': $('#q-sheet').close(); return;
      case 'challenge': {
        const ch = CHALLENGES[S.stage];
        if (!ch || !ch.action) return;
        if (ch.action.run() === 'open-q') { openQSheet(); return; }
        FOLDS['exp-' + S.stage] = true;   // muestra "Qué deberías ver" después de aplicar el reto
        rebuild(); renderLab(); toast('Listo: observa el resultado');
        return;
      }
      case 'quiz': S.quiz[el.dataset.q] = +el.dataset.i; renderLab(); return;
      case 'quiz-reset': L.QUIZZES[el.dataset.set].forEach(q => { delete S.quiz[q.id]; }); renderLab(); return;
      case 'open-steps': { const d = $('#step-sheet'); if (!d.open) d.showModal(); const cur = $('#map-sheet [aria-current="step"]'); if (cur) cur.scrollIntoView({ block: 'center' }); return; }
      case 'close-steps': $('#step-sheet').close(); return;
      case 'reset-lab': stopPlay(); initLab(true); renderLab(); toast('Laboratorio restablecido'); return;
      case 'toggle-doc': {
        const d = docByKey(S.docs, el.dataset.key);
        if (!el.checked && S.docs.filter(x => x.enabled).length === 1) { el.checked = true; toast('Deja al menos un documento activo'); return; }
        d.enabled = el.checked;
        if (!d.enabled && S.docKey === d.key) S.docKey = S.docs.find(x => x.enabled).key;
        rebuild(); renderLab(); return;
      }
      case 'remove-doc': S.docs = S.docs.filter(d => d.key !== el.dataset.key); if (S.docKey === el.dataset.key) S.docKey = S.docs[0].key; rebuild(); renderLab(); return;
      case 'add-doc': {
        const pages = S.newText.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
        if (!S.newTitle.trim() || !pages.length) { toast('Escribe un título y al menos una página de texto'); return; }
        const key = 'custom-' + E.contentHash(S.newTitle + pages.join()).slice(0, 6);
        if (docByKey(S.docs, key)) { toast('Ese documento ya está en el corpus'); return; }
        const slug = E.normalize(S.newTitle).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'documento';
        S.docs.push({ key, short: S.newTitle.trim().slice(0, 3).toUpperCase(), title: S.newTitle.trim(), source: slug + '.pdf', pages, enabled: true, custom: true });
        S.docKey = key;
        rebuild(); renderLab(); toast('Documento agregado e indexado'); return;
      }
      case 'view-doc': S.docKey = el.dataset.key; goStage('parse'); return;
      case 'pick-doc': {
        S.docKey = el.dataset.key;
        const first = S.index.points.find(p => p.docKey === S.docKey);
        if (first) S.pointId = first.id;
        renderLab(); return;
      }
      case 'pick-chunk': {
        const p = S.index.points.find(x => x.docKey === S.docKey && x.payload.chunk_index === +el.dataset.i);
        if (p) S.pointId = p.id;
        renderLab(); return;
      }
      case 'pick-point': {
        const p = S.index.points.find(x => x.id === el.dataset.id);
        if (p) { S.pointId = p.id; S.docKey = p.docKey; }
        renderLab(); return;
      }
      case 'pick-s3': S.s3Key = el.dataset.key; renderLab(); return;
      case 'set-model': S.cfg.model = el.dataset.model; rebuild(); renderLab(); toast('Índice reconstruido con ' + S.cfg.model); return;
      case 'sample': {
        S.query = C.SAMPLE_QUERIES.find(s => s.id === el.dataset.id).q;
        const qs = $('#q-sheet'); if (qs.open) qs.close();
        rerun(); renderLab(); return;
      }
      case 'mode': S.opts.mode = el.dataset.mode; rerun(); renderLab(); return;
      case 'toggle-rerank': S.opts.useRerank = el.checked; rerun(); renderLab(); return;
      case 'toggle-halluc': S.opts.hallucinate = el.checked; rerun(); renderLab(); return;
      default:
    }
  }

  // ================================================================ hojas: pregunta y término
  function openQSheet() {
    $('#q-sheet-body').innerHTML = `<form class="field" data-form="ask"><label for="q-sheet-input">Escribe tu pregunta</label>
        <div class="row"><input type="text" id="q-sheet-input" value="${esc(S.query)}" autocomplete="off"><button class="btn primary" type="submit">Preguntar</button></div></form>
      <span class="label">O elige un ejemplo</span>
      <div class="qs-list">${C.SAMPLE_QUERIES.map(x => `<button class="qs-item" data-action="sample" data-id="${x.id}" aria-pressed="${x.q === S.query}"><b>${esc(x.q)}</b><small>${esc(x.label)} · ${esc(x.hint)}</small></button>`).join('')}</div>`;
    const d = $('#q-sheet');
    if (!d.open) d.showModal();
  }
  const labTargetLabel = target => target.startsWith('#')
    ? ({ '#bluegreen': 'Reindexado blue-green', '#sizing': 'Memoria del índice' }[target] || 'Ver')
    : `Paso ${stageIdx(target) + 1}: ${STAGES[stageIdx(target)].title}`;
  function termHtml(key, withTitle) {
    const g = L.GLOSSARY[key];
    return `${withTitle ? `<h3>${esc(g.term)}</h3>` : ''}<p class="t-def">${esc(g.def)}</p>
      ${g.analogy ? `<p class="analogy"><b>Piénsalo así:</b> ${esc(g.analogy)}</p>` : ''}
      ${g.real ? `<p class="t-real"><b>En la vida real:</b> ${esc(g.real)}</p>` : ''}
      <div class="t-actions"><button class="btn small primary" data-term-go="${g.lab}">Verlo en el lab: ${esc(labTargetLabel(g.lab))}</button></div>
      ${g.rel && g.rel.length ? `<div class="t-rel"><span class="label">Relacionado</span><div class="sys-tags">${g.rel.map(r => `<button class="tag-btn" data-term="${r}">${esc(L.GLOSSARY[r].term)}</button>`).join('')}</div></div>` : ''}`;
  }
  function openTerm(key) {
    if (!L.GLOSSARY[key]) return;
    $('#term-title').textContent = L.GLOSSARY[key].term;
    $('#term-body').innerHTML = termHtml(key, false);
    const d = $('#term-sheet');
    if (!d.open) d.showModal();
  }
  function goTarget(target) {
    [$('#term-sheet'), $('#q-sheet'), $('#step-sheet')].forEach(d => { if (d.open) d.close(); });
    if (target.startsWith('#')) { location.hash = target.slice(1); return; }
    if (location.hash === '#lab') goStage(target);
    else { S.stage = target; S.visited.add(target); location.hash = 'lab'; }
  }
  function renderGlossary() {
    const q = E.normalize(($('#g-search') || { value: '' }).value.trim());
    const keys = Object.keys(L.GLOSSARY).sort((a, b) => L.GLOSSARY[a].term.localeCompare(L.GLOSSARY[b].term, 'es'));
    const hits = keys.filter(k => !q || E.normalize(L.GLOSSARY[k].term + ' ' + L.GLOSSARY[k].def).includes(q));
    $('#glossary-list').innerHTML = hits.length
      ? hits.map(k => `<article class="gcard" id="g-${k}">${termHtml(k, true)}</article>`).join('')
      : '<p class="muted">Ningún término coincide con la búsqueda.</p>';
    $('#g-count').textContent = `${hits.length} de ${keys.length} términos`;
  }

  // ================================================================ portada
  function renderHome() {
    $('#journey').innerHTML = STAGES.map((st, i) => `<li><a class="jstep ${S.visited.has(st.id) && i > 0 ? 'seen' : ''}" href="#lab" data-start="${st.id}">
      <span class="jn">${i + 1}</span>
      <span class="jt"><b>${esc(st.title)}</b><small>${esc(st.learn)}</small></span>
      <span class="pill ${{ index: 'dense', query: 'sparse' }[st.phase] || 'neutral'}">${{ intro: 'Introducción', index: 'Indexación', query: 'Consulta', close: 'Cierre' }[st.phase]}</span></a></li>`).join('');
    const cont = $('#continue-btn');
    const i = stageIdx(S.stage);
    cont.hidden = !(S.visited.size > 1 && i > 0);
    if (!cont.hidden) { cont.dataset.start = S.stage; cont.textContent = `Continuar: paso ${i + 1} · ${STAGES[i].title}`; }
    const SY = window.RagSystems;
    $('#systems').innerHTML = SY ? SY.GROUPS.map(g => `<div class="sys-group"><h3>${esc(g.title)}</h3><p class="sec-intro">${esc(g.intro)}</p>
      <div class="sys-grid">${g.items.map(it => `<article class="sys">
        <header><a href="${esc(it.url)}" target="_blank" rel="noopener noreferrer">${esc(it.name)} <span aria-hidden="true">↗</span></a><small>${esc(it.kind)}</small></header>
        <p>${esc(it.what)}</p>
        <div class="sys-tags">${it.concepts.map(c => `<button class="tag-btn" data-concept="${c}">${esc(SY.CONCEPTS[c].label)}</button>`).join('')}</div>
      </article>`).join('')}</div></div>`).join('') : '';
  }

  // ================================================================ blue-green
  const BG = {};
  const LATE_Q = '¿Dónde se estacionan las visitas?';
  function initBG() {
    if (BG.timer) clearInterval(BG.timer);
    if (BG.traffic) clearInterval(BG.traffic);
    const v1cfg = { name: 'docs_v1', size: 40, overlap: 8, model: 'mock-embed-small' };
    Object.assign(BG, {
      source: C.DOCS.slice(),
      cols: { docs_v1: { cfg: v1cfg, docs: C.DOCS.slice(), index: E.buildIndex(C.DOCS, v1cfg), status: 'active' } },
      v2cfg: { size: 25, overlap: 5, model: 'mock-embed-large' },
      alias: 'docs_v1',
      timer: null, traffic: null, snapshot: null,
      dualWrite: false, apiFollows: true, apiModel: 'mock-embed-small',
      evals: null, confirmSwitch: false, lateIngested: false,
      log: [],
    });
    bgLog('sys', 'Estado inicial: alias docs → docs_v1 (8 documentos).');
  }
  function bgLog(kind, msg) {
    const d = new Date();
    BG.log.unshift({ kind, msg, time: d.toTimeString().slice(0, 8) });
    BG.log = BG.log.slice(0, 60);
  }
  const v2 = () => BG.cols.docs_v2;
  const missingIn = col => BG.source.filter(d => !col.docs.some(x => x.key === d.key));
  function setColDocs(col, docs) { col.docs = docs; col.index = E.buildIndex(docs, col.cfg); }

  function bgQuery(q) {
    const col = BG.cols[BG.alias];
    const model = BG.apiFollows ? col.cfg.model : BG.apiModel;
    try {
      const t = E.runQuery(col.index, q, { queryModel: model });
      const top = t.final[0];
      bgLog('ok', `«${q}» → ${BG.alias}: ${top ? `${top.point.payload.title} (rerank ${fx(top.rerankScore, 2)})` : 'no lo sé (nada supera el umbral)'}`);
    } catch (err) {
      bgLog('err', `«${q}» → ${BG.alias}: ERROR ${err.message}. La API embebe con ${model} y la colección usa ${col.cfg.model}.`);
    }
  }

  function bgAction(a, el) {
    switch (a) {
      case 'bg-reset': initBG(); break;
      case 'bg-create': {
        const cfg = Object.assign({ name: 'docs_v2' }, BG.v2cfg);
        BG.cols.docs_v2 = { cfg, docs: [], index: E.buildIndex([], cfg), status: 'empty', progress: 0 };
        BG.evals = null;
        bgLog('sys', `create_collection docs_v2 (chunk ${cfg.size}/${cfg.overlap}, ${cfg.model}, ${E.dimsOf(cfg.model)} dims). Producción sigue en ${BG.alias}.`);
        break;
      }
      case 'bg-build': {
        const col = v2();
        BG.snapshot = BG.source.slice();
        col.status = 'building';
        bgLog('sys', `Reindexado iniciado: ${BG.snapshot.length} documentos leídos de S3 (lista congelada en este momento).`);
        let i = 0;
        BG.timer = setInterval(() => {
          const doc = BG.snapshot[i++];
          if (doc && !col.docs.some(d => d.key === doc.key)) setColDocs(col, col.docs.concat([doc]));
          col.progress = i / BG.snapshot.length;
          if (i >= BG.snapshot.length) {
            clearInterval(BG.timer); BG.timer = null;
            col.status = 'ready';
            bgLog('sys', `docs_v2 construida: ${col.docs.length} documentos, ${col.index.points.length} puntos.`);
          }
          renderBG();
        }, 650);
        break;
      }
      case 'bg-late': {
        if (BG.lateIngested) return;
        BG.lateIngested = true;
        BG.source.push(C.LATE_DOC);
        const active = BG.cols[BG.alias];
        setColDocs(active, active.docs.concat([C.LATE_DOC]));
        let where = BG.alias;
        const other = BG.alias === 'docs_v1' ? v2() : BG.cols.docs_v1;
        if (BG.dualWrite && other && other.index && other.status !== 'deleted') { setColDocs(other, other.docs.concat([C.LATE_DOC])); where += ' y ' + other.cfg.name + ' (dual-write)'; }
        bgLog('sys', `Ingesta: «${C.LATE_DOC.title}» guardado en S3 e indexado en ${where}.`);
        break;
      }
      case 'bg-dual': BG.dualWrite = el.checked; bgLog('sys', `Dual-write ${BG.dualWrite ? 'activado' : 'desactivado'}.`); break;
      case 'bg-catchup': {
        const col = v2();
        const miss = missingIn(col);
        setColDocs(col, col.docs.concat(miss));
        bgLog('sys', miss.length ? `Catch-up: ${miss.length} documento(s) modificados desde el inicio se reprocesaron en docs_v2.` : 'Catch-up: docs_v2 ya estaba al día.');
        break;
      }
      case 'bg-eval': {
        const golden = C.GOLDEN.concat(BG.lateIngested ? [{ q: LATE_Q, doc: 'estacionamiento' }] : []);
        BG.evals = { golden, rows: {} };
        for (const name of ['docs_v1', 'docs_v2']) {
          const col = BG.cols[name];
          if (col && col.index && col.index.points.length) BG.evals.rows[name] = E.evaluate(col.index, golden, {});
        }
        bgLog('sys', 'Evaluación sobre el golden set: ' + Object.entries(BG.evals.rows).map(([n, r]) => `${n} Recall@3 ${pct(r.recall)} · MRR ${fx(r.mrr, 2)}`).join(' | '));
        break;
      }
      case 'bg-switch': case 'bg-switch-force': {
        const target = BG.alias === 'docs_v1' ? 'docs_v2' : 'docs_v1';
        if (a === 'bg-switch' && switchWarnings(target).length) { BG.confirmSwitch = true; break; }
        BG.confirmSwitch = false;
        const from = BG.alias;
        BG.alias = target;
        BG.cols[target].status = 'active';
        BG.cols[from].status = 'standby';
        bgLog('sys', `update_collection_aliases: delete alias docs → ${from}; create alias docs → ${target}. Cambio atómico, sin downtime.`);
        break;
      }
      case 'bg-cancel-switch': BG.confirmSwitch = false; break;
      case 'bg-delete-v1': {
        const col = BG.cols.docs_v1;
        col.status = 'deleted'; col.index = null; col.docs = [];
        bgLog('sys', 'delete_collection docs_v1. Ya no hay rollback posible; se libera su memoria.');
        break;
      }
      case 'bg-api-follows': BG.apiFollows = el.checked; bgLog('sys', BG.apiFollows ? 'La API elige el modelo de embedding según la colección activa.' : `La API queda fija en ${BG.apiModel}.`); break;
      case 'bg-query': bgQuery(el.dataset.q); break;
      case 'bg-traffic': {
        if (BG.traffic) { clearInterval(BG.traffic); BG.traffic = null; bgLog('sys', 'Tráfico automático detenido.'); break; }
        const pool = C.GOLDEN.map(g => g.q).concat([LATE_Q]);
        let n = 0;
        BG.traffic = setInterval(() => { bgQuery(pool[n++ % pool.length]); renderBG(); }, 1700);
        bgLog('sys', 'Tráfico automático: una consulta cada 1.7 s.');
        break;
      }
      case 'bg-cfg-size': case 'bg-cfg-overlap': case 'bg-cfg-model': return;
      default: return;
    }
    renderBG();
  }

  function switchWarnings(target) {
    const col = BG.cols[target];
    const w = [];
    if (!col || !col.index) return ['La colección destino no existe.'];
    if (col.status === 'building') w.push(`docs_v2 aún se está construyendo (${pct(col.progress)}).`);
    const miss = missingIn(col);
    if (miss.length) w.push(`A ${target} le faltan ${miss.length} documento(s) que sí están en S3: ${miss.map(d => d.title).join(', ')}. Se perderían al cambiar.`);
    if (!BG.evals || !BG.evals.rows[target]) w.push('No has evaluado la colección destino contra el golden set.');
    else if (BG.evals.rows[BG.alias] && BG.evals.rows[target].mrr < BG.evals.rows[BG.alias].mrr) w.push(`La evaluación de ${target} es peor que la actual (MRR ${fx(BG.evals.rows[target].mrr, 2)} vs ${fx(BG.evals.rows[BG.alias].mrr, 2)}).`);
    if (!BG.apiFollows && col.cfg.model !== BG.apiModel) w.push(`${target} usa ${col.cfg.model} pero la API embebe las preguntas con ${BG.apiModel}: las consultas fallarán por dimensión.`);
    return w;
  }

  function colBox(name) {
    const col = BG.cols[name];
    if (!col) return `<div class="box gone"><h4>docs_v2</h4><p class="muted">Todavía no existe.</p></div>`;
    const st = {
      active: '<span class="pill good">activa</span>', standby: '<span class="pill neutral">en espera (rollback)</span>',
      building: '<span class="pill warn">construyendo</span>', ready: '<span class="pill neutral">lista</span>',
      empty: '<span class="pill neutral">vacía</span>', deleted: '<span class="pill bad">eliminada</span>',
    }[col.status];
    const miss = col.status === 'deleted' ? [] : missingIn(col);
    return `<div class="box ${BG.alias === name ? 'live' : ''} ${col.status === 'deleted' ? 'gone' : ''}">
      <h4>${name} ${st} ${BG.alias === name ? '<span class="alias-pill">◀ alias docs</span>' : ''}</h4>
      <dl><dt>Chunking</dt><dd>${col.cfg.size} palabras / ${col.cfg.overlap} traslape</dd><dt>Vectores</dt><dd>dense (${col.cfg.model}, ${E.dimsOf(col.cfg.model)} dims) + bm25 (sparse)</dd>
      <dt>Contenido</dt><dd>${col.docs.length} docs · ${col.index ? col.index.points.length : 0} puntos</dd>
      <dt>Memoria</dt><dd>${col.index ? bytes(col.index.points.length * E.dimsOf(col.cfg.model) * 4) : '0 B'}</dd></dl>
      ${col.status === 'building' ? `<div class="progress" role="progressbar" aria-valuenow="${Math.round(col.progress * 100)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${col.progress * 100}%"></i></div>` : ''}
      <div class="docchips">${col.docs.map(d => `<span class="docchip ${d.key === 'estacionamiento' ? 'new' : ''}">${esc(d.short)}</span>`).join('')}${miss.map(d => `<span class="docchip missing" title="Está en S3 pero no en esta colección">${esc(d.short)} falta</span>`).join('')}</div>
    </div>`;
  }

  function renderBG() {
    const c2 = v2();
    const building = c2 && c2.status === 'building';
    const built = c2 && (c2.status === 'ready' || c2.status === 'active' || c2.status === 'standby');
    const onV2 = BG.alias === 'docs_v2';
    const v1gone = BG.cols.docs_v1.status === 'deleted';
    const warnings = BG.confirmSwitch ? switchWarnings(onV2 ? 'docs_v1' : 'docs_v2') : [];
    const ev = BG.evals;
    const evalTable = ev ? `<div class="table-wrap"><table class="t"><thead><tr><th>Pregunta</th><th>Doc esperado</th>${Object.keys(ev.rows).map(n => `<th>${n}</th>`).join('')}</tr></thead><tbody>
      ${ev.golden.map((g, i) => `<tr><td>${esc(g.q)}</td><td>${esc(shortOf(g.doc))}</td>${Object.values(ev.rows).map(r => { const rk = r.rows[i].rank; return `<td class="n">${rk ? '#' + rk : '<span class="pill bad">no está</span>'}</td>`; }).join('')}</tr>`).join('')}
      <tr><td colspan="2"><b>Recall@3</b></td>${Object.values(ev.rows).map(r => `<td class="n"><b>${pct(r.recall)}</b></td>`).join('')}</tr>
      <tr><td colspan="2"><b>MRR</b></td>${Object.values(ev.rows).map(r => `<td class="n"><b>${fx(r.mrr, 2)}</b></td>`).join('')}</tr>
      </tbody></table></div>` : '<p class="muted">Ejecuta la evaluación en el paso 4.</p>';

    // en móvil solo se despliega el primer paso pendiente
    const doneFlags = [!!c2, !!built, !!(c2 && !missingIn(c2).length && BG.lateIngested), !!ev, onV2, v1gone];
    const current = Math.max(0, doneFlags.indexOf(false));
    const stepOpen = k => foldOpen('bg-' + k, !isMobile() || k === current);
    $('#bg').innerHTML = `<div class="bg">
      <div class="steps">
        <details class="step ${c2 ? 'done' : ''}" data-fold="bg-0"${stepOpen(0)}><summary><h3>Define la nueva estrategia</h3></summary>
          <p>docs_v2 se crea al lado de docs_v1. Producción no se entera.</p>
          <div class="controls">
            <div class="field"><label for="bg-size">Chunk (palabras)</label><input type="range" id="bg-size" data-bg-input="size" min="10" max="80" value="${BG.v2cfg.size}" ${c2 ? 'disabled' : ''}><output>${BG.v2cfg.size}</output></div>
            <div class="field"><label for="bg-overlap">Traslape</label><input type="range" id="bg-overlap" data-bg-input="overlap" min="0" max="${BG.v2cfg.size - 1}" value="${BG.v2cfg.overlap}" ${c2 ? 'disabled' : ''}><output>${BG.v2cfg.overlap}</output></div>
            <div class="field"><label for="bg-model">Modelo</label><select id="bg-model" data-bg-input="model" ${c2 ? 'disabled' : ''}>${Object.keys(E.MODELS).map(m => `<option value="${m}" ${m === BG.v2cfg.model ? 'selected' : ''}>${m} · ${E.dimsOf(m)} dims</option>`).join('')}</select></div>
          </div>
          <div class="actions"><button class="btn primary" data-bg="bg-create" ${c2 ? 'disabled' : ''}>Crear docs_v2</button></div></details>

        <details class="step ${built ? 'done' : ''}" data-fold="bg-1"${stepOpen(1)}><summary><h3>Reindexa desde S3</h3></summary>
          <p>Un job aparte lee cada documento fuente de S3 y lo procesa con la nueva estrategia. Nunca se lee del vector store viejo.</p>
          <div class="actions"><button class="btn primary" data-bg="bg-build" ${c2 && c2.status === 'empty' ? '' : 'disabled'}>Iniciar reindexado</button></div></details>

        <details class="step ${c2 && !missingIn(c2).length && BG.lateIngested ? 'done' : ''}" data-fold="bg-2"${stepOpen(2)}><summary><h3>No pierdas lo que llega mientras tanto</h3></summary>
          <p>Ingiere un documento nuevo mientras docs_v2 se construye. Sin dual-write ni catch-up, docs_v2 no lo tendrá.</p>
          <label class="check"><input type="checkbox" data-bg="bg-dual" ${BG.dualWrite ? 'checked' : ''}> Dual-write (la ingesta escribe en ambas colecciones)</label>
          <div class="actions"><button class="btn" data-bg="bg-late" ${BG.lateIngested ? 'disabled' : ''}>Ingerir «${esc(C.LATE_DOC.title)}»</button><button class="btn" data-bg="bg-catchup" ${c2 && !building && c2.status !== 'empty' ? '' : 'disabled'}>Catch-up</button></div></details>

        <details class="step ${ev ? 'done' : ''}" data-fold="bg-3"${stepOpen(3)}><summary><h3>Evalúa antes de exponer</h3></summary>
          <p>Golden set de ${C.GOLDEN.length} preguntas${BG.lateIngested ? ' + 1 sobre el documento nuevo' : ''}. Compara Recall@3 y MRR de ambas colecciones.</p>
          <div class="actions"><button class="btn" data-bg="bg-eval" ${built ? '' : 'disabled'}>Evaluar</button></div></details>

        <details class="step ${onV2 ? 'done' : ''}" data-fold="bg-4"${stepOpen(4)}><summary><h3>Cambia el alias</h3></summary>
          <p>Una sola llamada borra y crea el alias: las consultas nuevas usan la otra colección al instante.</p>
          <label class="check"><input type="checkbox" data-bg="bg-api-follows" ${BG.apiFollows ? 'checked' : ''}> La API usa el modelo de embedding de la colección activa</label>
          ${warnings.length ? `<div class="callout warn"><b>Antes de cambiar</b>${warnings.map(w => `<span>• ${esc(w)}</span>`).join('')}<span class="actions" style="display:flex;gap:6px;margin-top:6px"><button class="btn small danger" data-bg="bg-switch-force">Cambiar de todos modos</button><button class="btn small" data-bg="bg-cancel-switch">Cancelar</button></span></div>` : ''}
          <div class="actions"><button class="btn primary" data-bg="bg-switch" ${c2 && c2.status !== 'empty' && !v1gone ? '' : 'disabled'}>${onV2 ? 'Rollback a docs_v1' : 'Apuntar docs → docs_v2'}</button></div></details>

        <details class="step ${v1gone ? 'done' : ''}" data-fold="bg-5"${stepOpen(5)}><summary><h3>Retira la colección vieja</h3></summary>
          <p>Mantén docs_v1 unos días para rollback. Mientras coexisten pagas el doble de memoria.</p>
          <div class="actions"><button class="btn danger" data-bg="bg-delete-v1" ${onV2 && !v1gone ? '' : 'disabled'}>Eliminar docs_v1</button></div></details>
      </div>

      <div style="display:grid;gap:var(--s-4);align-content:start;min-width:0">
        <section class="panel"><h3>Topología</h3>
          <div class="topo">
            <div class="topo-row">
              <div class="box"><h4>API /query</h4><dl><dt>Consulta</dt><dd>alias docs</dd><dt>Modelo query</dt><dd>${BG.apiFollows ? BG.cols[BG.alias].cfg.model + ' (sigue a la colección)' : BG.apiModel + ' (fijo)'}</dd></dl></div>
              <div class="box"><h4>S3 · fuente de verdad</h4><dl><dt>Documentos</dt><dd>${BG.source.length}</dd></dl><div class="docchips">${BG.source.map(d => `<span class="docchip ${d.key === 'estacionamiento' ? 'new' : ''}">${esc(d.short)}</span>`).join('')}</div></div>
            </div>
            <div class="pointer"><span class="alias-pill">docs</span><span class="line"></span><span>apunta a <b class="mono">${BG.alias}</b></span></div>
            <div class="topo-row">${colBox('docs_v1')}${colBox('docs_v2')}</div>
          </div>
        </section>
        <section class="panel"><h3><span>Tráfico de consultas</span></h3>
          <div class="chips">${[C.GOLDEN[0].q, C.GOLDEN[2].q, LATE_Q].map(q => `<button class="chip" data-bg="bg-query" data-q="${esc(q)}">${esc(q)}</button>`).join('')}<button class="btn small" data-bg="bg-traffic">${BG.traffic ? 'Detener tráfico' : 'Tráfico automático'}</button></div>
          <div class="log" aria-live="polite">${BG.log.map(l => `<div class="log-row ${l.kind}"><time>${l.time}</time><span class="who">${{ sys: 'sistema', ok: 'consulta', err: 'error' }[l.kind]}</span><span>${esc(l.msg)}</span></div>`).join('')}</div>
        </section>
        <section class="panel"><h3>Evaluación</h3>${evalTable}</section>
      </div>
    </div>`;
  }

  function bgInput(el) {
    const k = el.dataset.bgInput;
    BG.v2cfg[k] = k === 'model' ? el.value : +el.value;
    if (BG.v2cfg.overlap >= BG.v2cfg.size) BG.v2cfg.overlap = BG.v2cfg.size - 1;
    renderBG();
    const again = document.getElementById(el.id);
    if (again) again.focus();
  }

  // ================================================================ dimensionamiento
  const SZ = { chunks: 10e6, dims: 1536, quant: 'float32', m: 16, payloadBytes: 2000, collections: 1 };
  const CHUNK_STEPS = [1e5, 5e5, 1e6, 5e6, 1e7, 5e7, 1e8];
  function renderSizing() {
    const r = E.sizing(SZ);
    const quantRows = ['float32', 'int8', 'binary'].map(q => {
      const x = E.sizing(Object.assign({}, SZ, { quant: q }));
      return `<tr class="${q === SZ.quant ? 'sel' : ''}"><td>${q}</td><td class="n">${bytes(x.ram)}</td><td class="n">${bytes(x.disk)}</td><td>${{ float32: 'Sin pérdida. Base de comparación.', int8: '~4× menos RAM en vectores; pérdida de precisión pequeña con re-scoring.', binary: '~32× menos RAM; requiere re-scoring con los originales en disco.' }[q]}</td></tr>`;
    }).join('');
    const parts = [
      ['Vectores en RAM', r.vectorsRam], ['Grafo HNSW (RAM)', r.hnsw],
      ['Payload (disco)', r.payloadDisk], ['Originales float32 en disco', r.originalsDisk],
    ];
    const max = Math.max(...parts.map(p => p[1])) || 1;
    const ci = CHUNK_STEPS.indexOf(SZ.chunks);
    $('#sizing').innerHTML = `<div class="sizing">
      <section class="panel"><h3>Parámetros</h3>
        <div class="field"><label for="sz-chunks">Fragmentos indexados</label><div class="row"><input type="range" id="sz-chunks" data-sz="chunks" min="0" max="${CHUNK_STEPS.length - 1}" step="1" value="${ci}"><output class="num">${SZ.chunks.toLocaleString('es-MX')}</output></div></div>
        <div class="field"><label for="sz-dims">Dimensiones del embedding</label><select id="sz-dims" data-sz="dims">${[384, 768, 1024, 1536, 3072].map(d => `<option ${d === SZ.dims ? 'selected' : ''}>${d}</option>`).join('')}</select></div>
        <div class="field"><span class="label">Cuantización</span><div class="seg" role="group" aria-label="Cuantización">${['float32', 'int8', 'binary'].map(q => `<button data-sz-q="${q}" aria-pressed="${q === SZ.quant}">${q}</button>`).join('')}</div></div>
        <div class="field"><label for="sz-m">HNSW m (conexiones por nodo)</label><select id="sz-m" data-sz="m">${[8, 16, 32, 64].map(m => `<option ${m === SZ.m ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
        <div class="field"><label for="sz-payload">Payload promedio por punto (bytes)</label><input type="range" id="sz-payload" data-sz="payloadBytes" min="200" max="8000" step="100" value="${SZ.payloadBytes}"><output class="num">${SZ.payloadBytes} B</output></div>
        <label class="check"><input type="checkbox" data-sz-bg ${SZ.collections === 2 ? 'checked' : ''}> Durante un blue-green (2 colecciones vivas)</label>
      </section>
      <div style="display:grid;gap:var(--s-4);align-content:start;min-width:0">
        <div class="stats">
          <div class="stat"><span class="label">RAM</span><span class="v">${bytes(r.ram)}</span><span class="k">vectores + grafo HNSW</span></div>
          <div class="stat"><span class="label">Disco</span><span class="v">${bytes(r.disk)}</span><span class="k">payload + vectores persistidos</span></div>
          <div class="stat"><span class="label">Por fragmento</span><span class="v">${bytes(r.ram / SZ.chunks / SZ.collections)}</span><span class="k">RAM por punto</span></div>
        </div>
        <section class="panel"><h3>Desglose</h3>${parts.map(p => `<div class="hbar"><span>${p[0]}</span><span class="track"><i style="width:${p[1] / max * 100}%"></i></span><span class="v">${bytes(p[1])}</span></div>`).join('')}
          <p class="panel-note">Fórmulas: vectores = fragmentos × dims × bytes por dimensión (4 en float32, 1 en int8, 1/8 en binario). HNSW ≈ fragmentos × m × 2 × 4 B × 1.1. Con cuantización, los originales float32 se guardan en disco para re-scoring. Es un orden de magnitud: agrega réplicas, WAL y margen operativo.</p>
        </section>
        <section class="panel"><h3>Comparación de cuantización</h3><div class="table-wrap"><table class="t"><thead><tr><th>Tipo</th><th>RAM</th><th>Disco</th><th>Nota</th></tr></thead><tbody>${quantRows}</tbody></table></div></section>
      </div></div>`;
  }
  function szInput(el) {
    const k = el.dataset.sz;
    SZ[k] = k === 'chunks' ? CHUNK_STEPS[+el.value] : +el.value;
    renderSizing();
    const again = document.getElementById(el.id);
    if (again) again.focus();
  }

  // Los sliders solo actualizan su etiqueta mientras se arrastran y recalculan al soltar,
  // porque re-renderizar el panel reemplaza el control y cortaría el arrastre.
  function dispatchInput(el) {
    if (el.matches('[data-input]') && el.closest('#view-lab')) labInput(el);
    else if (el.matches('[data-bg-input]')) bgInput(el);
    else if (el.matches('[data-sz]')) szInput(el);
  }
  document.addEventListener('input', e => {
    const el = e.target;
    if (el.type === 'range') {
      const out = el.parentElement && el.parentElement.querySelector('output');
      if (out) out.textContent = el.dataset.sz === 'chunks' ? CHUNK_STEPS[+el.value].toLocaleString('es-MX') : el.value + (el.dataset.sz === 'payloadBytes' ? ' B' : '');
      return;
    }
    if (el.id === 'g-search') { renderGlossary(); return; }
    if (el.tagName !== 'SELECT') dispatchInput(el);
  });
  document.addEventListener('change', e => {
    const el = e.target;
    if (el.type === 'range' || el.tagName === 'SELECT') dispatchInput(el);
  });

  // ================================================================ documentación
  const DOC = { file: 'rag-hibrido-guia.md', cache: {}, pendingRef: null };
  const slug = s => E.normalize(s).replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60);
  function renderMarkdown(md) {
    if (window.marked && window.marked.parse) return window.marked.parse(md, { mangle: false, headerIds: false });
    return `<div class="callout warn"><b>No se pudo cargar el renderizador de Markdown</b><span>Se muestra el texto sin formato.</span></div><pre class="code wrap">${esc(md)}</pre>`;
  }
  async function loadDoc(file) {
    DOC.file = file;
    $$('[data-doc-file]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.docFile === file)));
    const md = $('#md');
    try {
      if (!DOC.cache[file]) {
        const res = await fetch('docs/' + file);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        DOC.cache[file] = await res.text();
      }
      md.innerHTML = renderMarkdown(DOC.cache[file]);
    } catch (err) {
      md.innerHTML = `<div class="callout warn"><b>No se pudo cargar docs/${esc(file)}</b><span>Abre el proyecto con un servidor local en lugar de abrir el archivo directamente: <code>python3 -m http.server 8080</code> dentro de <code>projects/hybrid-rag-guide</code> y visita <code>http://localhost:8080</code>.</span></div>`;
      $('#toc').innerHTML = '';
      return;
    }
    $$('table', md).forEach(t => { const w = document.createElement('div'); w.className = 'table-wrap'; t.parentNode.insertBefore(w, t); w.appendChild(t); });
    const used = {};
    const heads = $$('h2, h3', md);
    heads.forEach(h => { let id = slug(h.textContent) || 'seccion'; if (used[id]) id += '-' + (++used[id]); else used[id] = 1; h.id = 'md-' + id; });
    $('#toc').innerHTML = heads.map(h => `<a href="#docs" data-toc="${h.id}" class="${h.tagName === 'H3' ? 'l3' : ''}">${esc(h.textContent)}</a>`).join('');
    if (DOC.pendingRef) { scrollToRef(DOC.pendingRef); DOC.pendingRef = null; }
  }
  function scrollToRef(ref) {
    const h = $$('#md h2').find(x => x.textContent.trim().startsWith(ref + ' '));
    if (!h) return;
    h.scrollIntoView({ behavior: 'smooth', block: 'start' });
    h.classList.remove('flash'); void h.offsetWidth; h.classList.add('flash');
  }
  function openDocRef(ref) {
    DOC.pendingRef = ref;
    if (location.hash !== '#docs') location.hash = 'docs';
    else if (DOC.file !== 'rag-hibrido-guia.md') loadDoc('rag-hibrido-guia.md');
    else { scrollToRef(ref); DOC.pendingRef = null; }
  }

  // ================================================================ router y clics globales
  const VIEWS = ['home', 'lab', 'glossary', 'advanced', 'bluegreen', 'sizing', 'docs'];
  const TAB_OF = { bluegreen: 'advanced', sizing: 'advanced' };
  function route() {
    const v = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'home';
    VIEWS.forEach(x => { $('#view-' + x).hidden = x !== v; });
    document.body.classList.toggle('lab-active', v === 'lab');
    $$('.tabs a').forEach(a => { if (a.dataset.view === (TAB_OF[v] || v)) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    if (v !== 'lab') stopPlay();
    if (v === 'home') renderHome();
    if (v === 'glossary') renderGlossary();
    if (v === 'lab') renderLab();
    if (v === 'bluegreen') renderBG();
    if (v === 'sizing') renderSizing();
    if (v === 'docs') {
      if (DOC.pendingRef && DOC.file !== 'rag-hibrido-guia.md') loadDoc('rag-hibrido-guia.md');
      else if (!$('#md h2')) loadDoc(DOC.file);
      else if (DOC.pendingRef) { scrollToRef(DOC.pendingRef); DOC.pendingRef = null; }
    }
  }
  window.addEventListener('hashchange', () => { window.scrollTo(0, 0); route(); });

  document.addEventListener('click', e => {
    const closer = e.target.closest('[data-close]');
    if (closer) { closer.closest('dialog').close(); return; }
    const term = e.target.closest('[data-term]');
    if (term) { e.preventDefault(); openTerm(term.dataset.term); return; }
    const go = e.target.closest('[data-term-go]');
    if (go) { goTarget(go.dataset.termGo); return; }
    const dlg = e.target.closest('dialog.sheet');
    if (dlg && e.target === dlg) { dlg.close(); return; }   // clic en el fondo de una hoja
    const start = e.target.closest('[data-start]');
    if (start) {   // enlaces de la portada a una etapa concreta (el href #lab cambia la vista)
      S.stage = start.dataset.start;
      S.visited.add(S.stage);
      if (location.hash === '#lab') { e.preventDefault(); renderLab(); window.scrollTo(0, 0); }
      return;
    }
    const concept = e.target.closest('[data-concept]');
    if (concept && window.RagSystems) {
      const target = window.RagSystems.CONCEPTS[concept.dataset.concept].target;
      if (target.startsWith('#')) location.hash = target.slice(1);
      else { S.stage = target; S.visited.add(target); location.hash = 'lab'; }
      return;
    }
    const st = e.target.closest('[data-stage]');
    if (st && st.dataset.stage) { goStage(st.dataset.stage); return; }
    const ref = e.target.closest('[data-doc-ref]');
    if (ref) { openDocRef(ref.dataset.docRef); return; }
    const df = e.target.closest('[data-doc-file]');
    if (df) { loadDoc(df.dataset.docFile); return; }
    const toc = e.target.closest('[data-toc]');
    if (toc) {
      e.preventDefault();
      const h = document.getElementById(toc.dataset.toc);
      if (isMobile()) $('#toc-wrap').open = false;
      if (h) h.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const mdLink = e.target.closest('#md a[href$=".md"]');
    if (mdLink) {   // enlaces entre documentos: se abren dentro de la app
      e.preventDefault();
      const file = mdLink.getAttribute('href').split('/').pop();
      if (['rag-hibrido-guia.md', 'REVISION.md'].includes(file)) { loadDoc(file); window.scrollTo(0, 0); }
      return;
    }

    const bg = e.target.closest('[data-bg]');
    if (bg) { bgAction(bg.dataset.bg, bg); return; }
    const q = e.target.closest('[data-sz-q]');
    if (q) { SZ.quant = q.dataset.szQ; renderSizing(); return; }
    const szbg = e.target.closest('[data-sz-bg]');
    if (szbg) { SZ.collections = szbg.checked ? 2 : 1; renderSizing(); return; }
    const act = e.target.closest('[data-action]');
    if (act) labAction(act.dataset.action, act);
  });

  // ================================================================ arranque
  initLab();
  initBG();
  $('#toc-wrap').open = !isMobile();
  route();

  // al cruzar el punto de corte (rotar el teléfono, redimensionar) se re-dibuja la vista actual
  mq.addEventListener('change', () => { $('#toc-wrap').open = !isMobile(); route(); });

  // la cabecera de progreso se pega justo debajo de la barra superior, mida lo que mida
  const syncTopbar = () => document.documentElement.style.setProperty('--topbar-h', $('.topbar').offsetHeight + 'px');
  syncTopbar();
  window.addEventListener('resize', syncTopbar);

  // instalación como app
  let installEvt = null;
  const installBtn = $('#install-btn');
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; installBtn.hidden = false; });
  if (isIOS && !isStandalone) installBtn.hidden = false;
  installBtn.addEventListener('click', async () => {
    if (installEvt) {
      installEvt.prompt();
      await installEvt.userChoice.catch(() => null);
      installEvt = null;
      installBtn.hidden = true;
    } else {
      toast('En Safari: toca Compartir y luego "Agregar a inicio"');
    }
  });
  window.addEventListener('appinstalled', () => { installBtn.hidden = true; toast('App instalada'); });

  // uso sin conexión (no disponible en todos los contextos: se ignora si falla)
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  }
})();
