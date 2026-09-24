/* UI del laboratorio. Depende de window.RagEngine y window.RagCorpus. */
(function () {
  'use strict';
  const E = window.RagEngine;
  const C = window.RagCorpus;

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
  const docByKey = (docs, key) => docs.find(d => d.key === key);
  const shortOf = key => (docByKey(S.docs, key) || docByKey([C.LATE_DOC], key) || { short: key.slice(0, 3).toUpperCase() }).short;

  // ================================================================ estado del laboratorio
  const S = {};
  function initLab() {
    Object.assign(S, {
      docs: C.DOCS.map(d => Object.assign({}, d, { enabled: true })),
      cfg: { name: 'docs_v1', size: 40, overlap: 8, model: 'mock-embed-small' },
      query: C.SAMPLE_QUERIES[0].q,
      opts: Object.assign({}, E.DEFAULTS),
      stage: 'docs',
      docKey: 'vacaciones',
      pointId: null,
      s3Key: null,
      simA: 'el gato duerme en el sofá',
      simB: 'el felino descansa en el mueble',
      visited: new Set(['docs']),
      newTitle: 'Lineamientos de estacionamiento',
      newText: C.LATE_DOC.pages.join('\n\n'),
    });
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
  const STAGES = [
    { id: 'docs', phase: 'index', title: 'Documentos fuente', io: ['PDFs', 'Documentos a indexar'], ref: 'Paso 7',
      lede: 'Todo empieza con los documentos que el sistema podrá consultar. Activa o desactiva documentos, o agrega uno propio: el índice se reconstruye y todas las etapas se recalculan.',
      prod: ['Guarda cada original en almacenamiento durable (S3) desde el primer día: es la fuente para reindexar.', 'Usa como doc_id un hash del contenido o un identificador estable del sistema de origen, nunca el nombre del archivo.', 'Valida tipo y tamaño del archivo y exige autenticación para ingerir.'] },
    { id: 'parse', phase: 'index', title: 'Parseo', io: ['PDF', 'Texto por página + doc_id'], ref: 'Paso 5',
      lede: 'El PDF se convierte en texto, página por página. Se conserva el número de página para poder citar después, y el doc_id se calcula a partir del contenido.',
      prod: ['pypdf no hace OCR: un PDF escaneado devuelve texto vacío.', 'Registra qué parser y versión se usó; cambiarlo obliga a reindexar.', 'Guarda el texto extraído junto al original para reindexar sin volver a parsear.'] },
    { id: 'chunk', phase: 'index', title: 'Chunking', io: ['Texto por página', 'Fragmentos con página'], ref: 'Paso 5',
      lede: 'Cada página se corta en fragmentos de N palabras con un traslape para no partir ideas a la mitad. Un fragmento nunca cruza de una página a otra.',
      prod: ['Los modelos miden en tokens: en español una palabra equivale a 1.3–1.6 tokens aprox.', 'Cortar por estructura (títulos, párrafos) suele funcionar mejor que cortar cada N palabras.', 'Cambiar tamaño o traslape cambia todos los fragmentos: requiere un reindexado blue-green.'] },
    { id: 'embed', phase: 'index', title: 'Embeddings', io: ['Fragmento', 'Vector denso + vector sparse'], ref: 'Paso -1',
      lede: 'Cada fragmento se guarda con dos vectores en el mismo punto de Qdrant: "dense", que captura el significado, y "bm25", un vector sparse con los términos exactos y su frecuencia (lo genera fastembed con el modelo Qdrant/bm25, localmente y sin costo).',
      prod: ['Envía los textos a la API de embeddings en lotes y con reintentos.', 'El vector sparse usa una longitud promedio fija: depende solo de su chunk y no hay que recalcularlo cuando llegan documentos nuevos.', 'Guarda en el payload qué modelo generó el vector.', 'Si cambias de modelo, los vectores viejos y nuevos no son comparables.'] },
    { id: 'store', phase: 'index', title: 'Almacenamiento', io: ['Vectores + metadata', 'Puntos en Qdrant, objetos en S3'], ref: 'Paso 11',
      lede: 'La ingesta escribe en dos lugares. S3 guarda el original y el texto extraído. Qdrant guarda un punto por fragmento con dos vectores con nombre (dense y bm25) y un payload con texto y metadata. BM25 no es un índice aparte: vive en la misma colección. La API consulta siempre el alias docs, nunca la colección física.',
      prod: ['IDs deterministas (uuid5 de doc_id:chunk_index): reingestar sobrescribe en vez de duplicar.', 'Crea índices de payload para doc_id y chunk_index (filtros y borrados).', 'Crea la colección versionada y su alias desde el primer día.'] },
    { id: 'question', phase: 'query', title: 'Pregunta', io: ['Texto de la persona', 'Términos normalizados'], ref: 'Paso 12',
      lede: 'La pregunta pasa por la misma normalización que los documentos: minúsculas, sin acentos, sin palabras vacías y con stemming. Elige un ejemplo o escribe tu propia pregunta.',
      prod: ['El filtro por tenant_id sale del token del usuario, nunca del cuerpo de la petición.', 'Aplica límites de peticiones por usuario.'] },
    { id: 'qembed', phase: 'query', title: 'Embedding de la pregunta', io: ['Pregunta', 'Vector de la pregunta'], ref: 'Paso -1',
      lede: 'La pregunta se convierte en vector con el mismo modelo que se usó al indexar. En el mapa, la pregunta cae cerca de los fragmentos con significado parecido.',
      prod: ['El modelo de la pregunta debe ser el mismo de la colección. Si cambias de modelo, cambia ambos a la vez (ver Reindexado blue-green).', 'Es un costo pequeño pero recurrente: uno por pregunta.'] },
    { id: 'dense', phase: 'query', title: 'Búsqueda densa', io: ['Vector de la pregunta', 'Top-N por similitud coseno'], ref: 'Paso 6',
      lede: 'Busca los fragmentos cuyo vector apunta en la dirección más parecida a la del vector de la pregunta (similitud coseno). Entiende paráfrasis, pero es débil con códigos y folios.',
      prod: ['Es el prefetch "dense" de la llamada híbrida a Qdrant (ver etapa Fusión RRF).', 'Con millones de vectores se usa un índice aproximado (HNSW): muy rápido a cambio de una pérdida mínima de precisión.', 'El filtro por tenant va dentro del prefetch.'] },
    { id: 'bm25', phase: 'query', title: 'BM25 en Qdrant', io: ['Términos de la pregunta', 'Top-N por coincidencia exacta'], ref: 'Paso 6',
      lede: 'BM25 puntúa coincidencias exactas de términos. Corre dentro de Qdrant sobre el vector sparse "bm25": la frecuencia de cada término se guardó al indexar y Qdrant multiplica por el IDF, que calcula con las estadísticas de la colección (Modifier.IDF). Los términos raros, como un folio, pesan más.',
      prod: ['Es el prefetch "bm25" de la misma llamada que la búsqueda densa.', 'Configura el analizador para español (stemming y palabras vacías).', 'OpenSearch solo si ya lo operas o necesitas sinónimos y diccionarios de dominio.'] },
    { id: 'rrf', phase: 'query', title: 'Fusión RRF en Qdrant', io: ['Dos prefetch (dense y bm25)', 'Una lista fusionada'], ref: 'Paso 6',
      lede: 'Qdrant combina las dos listas en el servidor usando solo la posición: cada fragmento suma 1/(k + posición) por cada lista donde aparece. Así no hay que comparar scores de escalas distintas. Búsqueda densa, BM25 y fusión son una sola llamada a la Query API.',
      prod: ['k = 60 es el valor típico; revisa qué constante usa tu versión de Qdrant y si permite ajustarla.', 'Si necesitas otro k, pide las dos listas por separado y fusiona en tu código.'] },
    { id: 'rerank', phase: 'query', title: 'Reranking', io: ['Candidatos fusionados', 'Top-K sobre el umbral'], ref: 'Paso 6',
      lede: 'Un cross-encoder lee la pregunta y cada candidato juntos y les asigna un score de relevancia. Es más preciso y más caro, por eso solo reordena los candidatos ya fusionados. Lo que queda bajo el umbral no llega al LLM.',
      prod: ['Calibra el umbral con el golden set.', 'Si ningún candidato supera el umbral, responde "no lo sé" sin llamar al LLM.'] },
    { id: 'generate', phase: 'query', title: 'Generación', io: ['Pregunta + Top-K', 'Respuesta con citas [n]'], ref: 'Paso 7',
      lede: 'El LLM recibe instrucciones, la pregunta y los fragmentos numerados. Debe responder solo con ese contexto y citar cada afirmación. Aquí el LLM es simulado: extrae las oraciones más relevantes.',
      prod: ['Delimita el contexto y trata su contenido como datos, no como instrucciones.', 'Un fragmento con instrucciones embebidas se pone en cuarentena.', 'El LLM suele ser el costo dominante por consulta.'] },
    { id: 'verify', phase: 'query', title: 'Verificación de citas', io: ['Respuesta + fragmentos', 'Citas validadas'], ref: 'Paso 7',
      lede: 'Antes de mostrar la respuesta se comprueba que cada cita exista y que la oración esté respaldada por el fragmento citado.',
      prod: ['Define qué hacer si falla: reintentar, quitar la oración o marcar baja confianza.', 'Mide la tasa de citas inválidas como métrica de calidad.'] },
  ];
  const stageIdx = id => STAGES.findIndex(s => s.id === id);

  function metric(id) {
    const ix = S.index, t = S.trace;
    const active = S.docs.filter(d => d.enabled);
    switch (id) {
      case 'docs': return `${active.length} documentos`;
      case 'parse': return `${active.reduce((a, d) => a + d.pages.length, 0)} páginas`;
      case 'chunk': return `${ix.points.length} fragmentos`;
      case 'embed': return `${ix.dims} dims · ${S.cfg.model}`;
      case 'store': return `${ix.s3.length} obj · ${ix.points.length} puntos`;
      case 'question': return `${t.queryTerms.length} términos`;
      case 'qembed': { const c = topConcepts(t.qvec)[0]; return c ? 'concepto: ' + c.name : 'solo dims hash'; }
      case 'dense': return `${t.dense.length} resultados`;
      case 'bm25': return `${t.bm25.length} resultados`;
      case 'rrf': return `${t.fused.length} fusionados`;
      case 'rerank': return S.opts.useRerank ? `${t.final.length} ≥ umbral` : 'desactivado';
      case 'generate': return t.generation.blocked.length ? 'cuarentena: ' + t.generation.blocked.length : (t.generation.answer === E.NO_ANSWER ? '"no lo sé"' : 'respuesta lista');
      case 'verify': return t.verification.noAnswer ? 'sin citas' : (t.verification.ok ? 'citas válidas' : 'revisar citas');
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
    $('#map').innerHTML = `
      <div class="map-phase"><span class="label">Fase 1 · Indexación</span>${idx.map(s => node(s)).join(flow)}</div>
      <div class="map-phase"><span class="label">Almacenamiento</span>
        <div class="storebox ${io ? 'active' : ''}">
          <button class="db" data-stage="store"><b>S3</b><span>rag-docs/</span><span class="m">${S.index.s3.length} objetos</span></button>
          <button class="db" data-stage="store"><b>Qdrant</b><span>alias docs → ${esc(S.cfg.name)}</span><span class="m">${S.index.points.length} puntos · ${S.index.dims} dims</span></button>
          <p class="io">${esc(io)}</p>
        </div>
      </div>
      <div class="map-phase"><span class="label">Fase 2 · Consulta</span>
        ${node(q[0])}${flow}${node(q[1])}${flow}
        <div class="qcall"><span class="label">Qdrant · una llamada a la Query API</span>
          <div class="node-pair">${node(q[2], 'dense')}${node(q[3], 'sparse')}</div>${node(q[4])}
        </div>${flow}
        ${q.slice(5).map(s => node(s)).join(flow)}
      </div>`;
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
    const W = 640, H = 340, pad = 34;
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
      ? 'Los dos <code>prefetch</code> corren dentro de Qdrant (etapas 8 y 9) y <code>{"fusion": "rrf"}</code> los fusiona (etapa 10). El filtro de tenant va en cada prefetch.'
      : `Modo ${esc(modeName(S.opts.mode))}: una sola búsqueda con <code>using: "${S.opts.mode}"</code>, sin fusión.`;
    return `<pre class="code">POST /collections/docs/points/query\n${esc(json)}</pre><p class="panel-note">${note}</p>`;
  }
  const qdrantHint = () => `<div class="callout info"><span>Esta búsqueda no es un servicio aparte: es un <code>prefetch</code> de la llamada híbrida a Qdrant.</span><button class="btn small" data-stage="rrf" style="justify-self:start">Ver la llamada completa</button></div>`;
  const panel = (title, body, aside) => `<section class="panel"><h3><span>${title}</span>${aside ? `<span class="muted num" style="font-weight:400;font-size:.85rem">${aside}</span>` : ''}</h3>${body}</section>`;

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
      ${panel('S3 · bucket rag-docs', `<div class="table-wrap"><table class="t"><thead><tr><th>Clave</th><th>Tamaño</th></tr></thead><tbody>${ix.s3.map(o => `<tr class="click ${o.key === S.s3Key ? 'sel' : ''}" data-action="pick-s3" data-key="${esc(o.key)}"><td class="mono">${esc(o.key)}</td><td class="n">${bytes(o.bytes)}</td></tr>`).join('')}</tbody></table></div>
        ${obj ? (obj.body ? `<pre class="code wrap">${esc(JSON.stringify(obj.body, null, 2))}</pre>` : `<p class="panel-note">Archivo binario (PDF original). Es la fuente de verdad para reindexar si cambia el parser.</p>`) : '<p class="panel-note">Selecciona un objeto para ver su contenido.</p>'}`, `${ix.s3.length} objetos`)}
      <div style="display:grid;gap:var(--s-4);align-content:start">
        ${panel('Qdrant · alias', `<div class="table-wrap"><table class="t"><thead><tr><th>Alias</th><th>Colección física</th></tr></thead><tbody><tr><td class="mono">docs</td><td class="mono">${esc(ix.name)}</td></tr></tbody></table></div><p class="panel-note">La API consulta <code>docs</code>. Para reindexar se construye otra colección y se mueve el alias (pestaña Reindexado blue-green).</p>`)}
        ${panel('Qdrant · configuración de la colección', `<pre class="code">${esc(JSON.stringify(collection, null, 2))}</pre><p class="panel-note">BM25 no es un índice aparte: es el vector sparse <code>bm25</code> de cada punto, y Qdrant mantiene las estadísticas de IDF de la colección. Memoria de este índice de juguete: ${ix.points.length} × ${ix.dims} dims × 4 B = <b>${bytes(ix.points.length * ix.dims * 4)}</b> en vectores. Calcula uno real en Dimensionamiento.</p>`)}
      </div></div>` +
      `<div class="grid-2">${panel('Qdrant · puntos', `<div class="table-wrap"><table class="t"><thead><tr><th>ID</th><th>Doc</th><th>Pág.</th><th>Chunk</th><th>Vector denso</th><th>Términos sparse</th></tr></thead><tbody>${rows}</tbody></table></div>`, `${ix.points.length} puntos`)}
      ${panel('Punto seleccionado', p ? `<pre class="code">${esc(pointJson)}</pre>` : '<p class="muted">Selecciona un punto.</p>')}</div>`;
  };

  // ---------------------------------------------------------------- consulta
  function queryStrip() {
    const t = S.trace;
    const status = t.generation.blocked.length ? '<span class="pill warn">⚠ fragmento en cuarentena</span>' : '';
    const verdict = t.verification.noAnswer ? '<span class="pill neutral">sin respuesta</span>' : (t.verification.ok ? '<span class="pill good">✓ citas válidas</span>' : '<span class="pill bad">✗ citas por revisar</span>');
    return `<div class="qstrip"><span class="label">Pregunta en curso · modo ${esc(modeName(S.opts.mode))}${S.opts.useRerank ? ' + rerank' : ''}</span><q>${esc(S.query)}</q><span class="ans">${esc(t.generation.answer.slice(0, 180))}${t.generation.answer.length > 180 ? '…' : ''} ${verdict} ${status}</span></div>`;
  }
  const modeName = m => ({ hybrid: 'híbrido', dense: 'solo densa', bm25: 'solo BM25' }[m]);

  R.question = () => {
    const raw = E.rawTokens(S.query);
    const sample = C.SAMPLE_QUERIES.find(s => s.q === S.query);
    return panel('Tu pregunta', `
      <form class="field" data-form="ask"><label for="q-input">Pregunta</label>
        <div class="row"><input type="text" id="q-input" value="${esc(S.query)}" autocomplete="off"><button class="btn primary" type="submit">Preguntar</button></div></form>
      <span class="label">Ejemplos</span>
      <div class="chips">${C.SAMPLE_QUERIES.map(s => `<button class="chip" data-action="sample" data-id="${s.id}" aria-pressed="${s.q === S.query}">${esc(s.label)}<small>${esc(s.q)}</small></button>`).join('')}</div>
      ${sample ? `<div class="callout info"><b>Qué observar</b><span>${esc(sample.hint)}</span></div>` : ''}`) +
      panel('Estrategia de búsqueda', `<div class="controls">
        <div class="field"><span class="label">Modo</span><div class="seg" role="group" aria-label="Modo de búsqueda">${['hybrid', 'dense', 'bm25'].map(m => `<button data-action="mode" data-mode="${m}" aria-pressed="${S.opts.mode === m}">${modeName(m)}</button>`).join('')}</div></div>
        <label class="check"><input type="checkbox" data-action="toggle-rerank" ${S.opts.useRerank ? 'checked' : ''}> Reranking</label>
      </div><p class="panel-note">Compara los modos con las preguntas de ejemplo: la respuesta final cambia según qué fragmentos llegan al LLM.</p>`) +
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
        ${unknown.length ? `<div class="callout warn"><b>Términos sin concepto</b><span>${unknown.map(u => `<code>${esc(u)}</code>`).join(' ')} solo caen en dimensiones hash. La búsqueda densa casi no los distingue; BM25 sí los encuentra si aparecen tal cual.</span></div>` : ''}`)}
      ${panel('La pregunta en el mapa', `${scatter({ query: t.qvec, highlight: new Set(t.dense.slice(0, 3).map(r => r.point.id)) })}<p class="panel-note">El rombo es la pregunta, proyectada en el mismo plano que los fragmentos. Los puntos resaltados son los 3 más cercanos por coseno (en el espacio completo, no en esta proyección 2D).</p>`)}
    </div>`;
  };

  R.dense = () => {
    const t = S.trace;
    const off = S.opts.mode === 'bm25' ? '<div class="callout warn">El modo actual es "solo BM25": la búsqueda densa no se ejecuta. Cámbialo en la etapa Pregunta.</div>' : '';
    const max = t.dense.length ? t.dense[0].score : 1;
    return off + qdrantHint() + panel('Candidatos', slider('cand', 'Límite de cada prefetch (N)', 3, 15, 1, S.opts.candidates)) +
      `<div class="grid-2">${panel('Resultados por similitud coseno', `<div class="results">${t.dense.map(r => resRow(r, { label: 'cos ' + fx(r.score), bar: Math.max(0, r.score) / (max || 1), cls: 'd' })).join('') || '<p class="muted">Sin resultados.</p>'}</div>`, `top ${t.dense.length}`)}
      ${panel('Vecinos en el mapa', scatter({ query: t.qvec, highlight: new Set(t.dense.slice(0, 5).map(r => r.point.id)) }) + '<p class="panel-note">Líneas: los 5 vecinos más cercanos de la pregunta.</p>')}</div>`;
  };

  R.bm25 = () => {
    const t = S.trace;
    const off = S.opts.mode === 'dense' ? '<div class="callout warn">El modo actual es "solo densa": BM25 no se ejecuta. Cámbialo en la etapa Pregunta.</div>' : '';
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
        <div class="table-wrap"><table class="t"><thead><tr><th>#</th><th>Fragmento</th><th>Pos. densa</th><th>Aporte</th><th>Pos. BM25</th><th>Aporte</th><th>RRF</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`, `${t.fused.length} candidatos`);
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
    const answer = g.parts.length
      ? g.parts.map(p => `${esc(p.text)} <span class="cite ${p.cite > t.final.length ? 'bad' : ''}">${p.cite}</span>.`).join(' ')
      : esc(g.answer);
    const sources = t.final.map((r, i) => `<tr><td class="n">[${i + 1}]</td><td>${esc(r.point.payload.source)}</td><td class="n">${r.point.payload.page}</td><td class="n">${r.point.payload.chunk_index}</td></tr>`).join('');
    return panel('Simulación', `<label class="check"><input type="checkbox" data-action="toggle-halluc" ${S.opts.hallucinate ? 'checked' : ''}> Simular una alucinación (el LLM agrega una afirmación con una cita que no existe)</label>`) +
      blocked +
      `<div class="grid-2">
      ${panel('Respuesta', `<p class="answer">${answer}</p>${sources ? `<div class="table-wrap"><table class="t"><thead><tr><th>Cita</th><th>Fuente</th><th>Pág.</th><th>Chunk</th></tr></thead><tbody>${sources}</tbody></table></div>` : ''}`)}
      ${panel('Prompt enviado al LLM', `<span class="label">System</span><pre class="code wrap">${esc(E.SYSTEM_PROMPT)}</pre><span class="label">User</span><pre class="code wrap">${esc(g.prompt)}</pre>`)}
      </div>`;
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
    const phaseStages = STAGES.filter(s => s.phase === st.phase);
    const k = phaseStages.indexOf(st) + 1;
    const i = stageIdx(st.id);
    const prev = STAGES[i - 1], next = STAGES[i + 1];
    let body;
    try { body = R[st.id](); } catch (err) { body = `<div class="callout bad"><b>No se pudo calcular esta etapa</b><span>${esc(err.message)}</span></div>`; }
    $('#stage').innerHTML = `
      <header class="stage-head">
        <p class="eyebrow">${st.phase === 'index' ? 'Fase 1 · Indexación' : 'Fase 2 · Consulta'} · etapa ${k} de ${phaseStages.length}</p>
        <h2>${esc(st.title)}</h2>
        <p class="lede">${esc(st.lede)}</p>
        <div class="io-row"><span><b>Entra</b>${esc(st.io[0])}</span><span><b>Sale</b>${esc(st.io[1])}</span></div>
      </header>
      ${st.phase === 'query' ? queryStrip() : ''}
      ${body}
      <aside class="prod-note"><h3>En producción</h3><ul>${st.prod.map(p => `<li>${esc(p)}</li>`).join('')}</ul><button class="btn small" data-doc-ref="${esc(st.ref)}">Leer en la guía: ${esc(st.ref)}</button></aside>
      <nav class="stepper" aria-label="Navegación entre etapas">
        <button class="btn" data-stage="${prev ? prev.id : ''}" ${prev ? '' : 'disabled'}>← ${prev ? esc(prev.title) : 'Inicio'}</button>
        <button class="btn primary" data-stage="${next ? next.id : ''}" ${next ? '' : 'disabled'}>${next ? esc(next.title) : 'Fin'} →</button>
      </nav>`;
  }
  function renderLab() {
    renderMap();
    renderStage();
    // en pantallas angostas el mapa es una tira horizontal: centra la etapa actual
    const map = $('#map'), cur = $('#map [aria-current="step"]');
    if (cur && map.scrollWidth > map.clientWidth + 4 && getComputedStyle(map).display === 'flex') {
      const mr = map.getBoundingClientRect(), cr = cur.getBoundingClientRect();
      map.scrollLeft += cr.left - mr.left - (mr.width - cr.width) / 2;
    }
  }
  function goStage(id, keepPlaying) {
    if (!id) return;
    if (!keepPlaying) stopPlay();
    S.stage = id;
    S.visited.add(id);
    renderLab();
    const top = $('#stage').getBoundingClientRect().top;
    if (top < 60 || top > window.innerHeight * 0.6) window.scrollTo({ top: window.scrollY + top - 90, behavior: 'smooth' });
  }

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
    const q = $('#q-input').value.trim();
    if (!q) { toast('Escribe una pregunta'); return; }
    S.query = q;
    rerun();
    renderLab();
    toast('Pregunta recalculada en todas las etapas');
  });

  function labAction(a, el) {
    switch (a) {
      case 'play': togglePlay(); return;
      case 'reset-lab': stopPlay(); initLab(); renderLab(); toast('Laboratorio restablecido'); return;
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
      case 'sample': S.query = C.SAMPLE_QUERIES.find(s => s.id === el.dataset.id).q; rerun(); renderLab(); return;
      case 'mode': S.opts.mode = el.dataset.mode; rerun(); renderLab(); return;
      case 'toggle-rerank': S.opts.useRerank = el.checked; rerun(); renderLab(); return;
      case 'toggle-halluc': S.opts.hallucinate = el.checked; rerun(); renderLab(); return;
      default:
    }
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

    $('#bg').innerHTML = `<div class="bg">
      <div class="steps">
        <div class="step ${c2 ? 'done' : ''}"><h3>Define la nueva estrategia</h3>
          <p>docs_v2 se crea al lado de docs_v1. Producción no se entera.</p>
          <div class="controls">
            <div class="field"><label for="bg-size">Chunk (palabras)</label><input type="range" id="bg-size" data-bg-input="size" min="10" max="80" value="${BG.v2cfg.size}" ${c2 ? 'disabled' : ''}><output>${BG.v2cfg.size}</output></div>
            <div class="field"><label for="bg-overlap">Traslape</label><input type="range" id="bg-overlap" data-bg-input="overlap" min="0" max="${BG.v2cfg.size - 1}" value="${BG.v2cfg.overlap}" ${c2 ? 'disabled' : ''}><output>${BG.v2cfg.overlap}</output></div>
            <div class="field"><label for="bg-model">Modelo</label><select id="bg-model" data-bg-input="model" ${c2 ? 'disabled' : ''}>${Object.keys(E.MODELS).map(m => `<option value="${m}" ${m === BG.v2cfg.model ? 'selected' : ''}>${m} · ${E.dimsOf(m)} dims</option>`).join('')}</select></div>
          </div>
          <div class="actions"><button class="btn primary" data-bg="bg-create" ${c2 ? 'disabled' : ''}>Crear docs_v2</button></div></div>

        <div class="step ${built ? 'done' : ''}"><h3>Reindexa desde S3</h3>
          <p>Un job aparte lee cada documento fuente de S3 y lo procesa con la nueva estrategia. Nunca se lee del vector store viejo.</p>
          <div class="actions"><button class="btn primary" data-bg="bg-build" ${c2 && c2.status === 'empty' ? '' : 'disabled'}>Iniciar reindexado</button></div></div>

        <div class="step ${c2 && !missingIn(c2).length && BG.lateIngested ? 'done' : ''}"><h3>No pierdas lo que llega mientras tanto</h3>
          <p>Ingiere un documento nuevo mientras docs_v2 se construye. Sin dual-write ni catch-up, docs_v2 no lo tendrá.</p>
          <label class="check"><input type="checkbox" data-bg="bg-dual" ${BG.dualWrite ? 'checked' : ''}> Dual-write (la ingesta escribe en ambas colecciones)</label>
          <div class="actions"><button class="btn" data-bg="bg-late" ${BG.lateIngested ? 'disabled' : ''}>Ingerir «${esc(C.LATE_DOC.title)}»</button><button class="btn" data-bg="bg-catchup" ${c2 && !building && c2.status !== 'empty' ? '' : 'disabled'}>Catch-up</button></div></div>

        <div class="step ${ev ? 'done' : ''}"><h3>Evalúa antes de exponer</h3>
          <p>Golden set de ${C.GOLDEN.length} preguntas${BG.lateIngested ? ' + 1 sobre el documento nuevo' : ''}. Compara Recall@3 y MRR de ambas colecciones.</p>
          <div class="actions"><button class="btn" data-bg="bg-eval" ${built ? '' : 'disabled'}>Evaluar</button></div></div>

        <div class="step ${onV2 ? 'done' : ''}"><h3>Cambia el alias</h3>
          <p>Una sola llamada borra y crea el alias: las consultas nuevas usan la otra colección al instante.</p>
          <label class="check"><input type="checkbox" data-bg="bg-api-follows" ${BG.apiFollows ? 'checked' : ''}> La API usa el modelo de embedding de la colección activa</label>
          ${warnings.length ? `<div class="callout warn"><b>Antes de cambiar</b>${warnings.map(w => `<span>• ${esc(w)}</span>`).join('')}<span class="actions" style="display:flex;gap:6px;margin-top:6px"><button class="btn small danger" data-bg="bg-switch-force">Cambiar de todos modos</button><button class="btn small" data-bg="bg-cancel-switch">Cancelar</button></span></div>` : ''}
          <div class="actions"><button class="btn primary" data-bg="bg-switch" ${c2 && c2.status !== 'empty' && !v1gone ? '' : 'disabled'}>${onV2 ? 'Rollback a docs_v1' : 'Apuntar docs → docs_v2'}</button></div></div>

        <div class="step ${v1gone ? 'done' : ''}"><h3>Retira la colección vieja</h3>
          <p>Mantén docs_v1 unos días para rollback. Mientras coexisten pagas el doble de memoria.</p>
          <div class="actions"><button class="btn danger" data-bg="bg-delete-v1" ${onV2 && !v1gone ? '' : 'disabled'}>Eliminar docs_v1</button></div></div>
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
  const VIEWS = ['lab', 'bluegreen', 'sizing', 'docs'];
  function route() {
    const v = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'lab';
    VIEWS.forEach(x => { $('#view-' + x).hidden = x !== v; });
    $$('.tabs a').forEach(a => { if (a.dataset.view === v) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    if (v !== 'lab') stopPlay();
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
    const st = e.target.closest('[data-stage]');
    if (st && st.dataset.stage) { goStage(st.dataset.stage); return; }
    const ref = e.target.closest('[data-doc-ref]');
    if (ref) { openDocRef(ref.dataset.docRef); return; }
    const df = e.target.closest('[data-doc-file]');
    if (df) { loadDoc(df.dataset.docFile); return; }
    const toc = e.target.closest('[data-toc]');
    if (toc) { e.preventDefault(); const h = document.getElementById(toc.dataset.toc); if (h) h.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
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
  route();
})();
