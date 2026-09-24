// Ejecuta con: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../assets/js/engine.js');
const C = require('../assets/js/corpus.js');

const index = E.buildIndex(C.DOCS, {});
const sample = id => C.SAMPLE_QUERIES.find(s => s.id === id).q;

test('stemming unifica singular y plural', () => {
  assert.equal(E.stem('vacaciones'), E.stem('vacacion'));
  assert.equal(E.stem('libres'), E.stem('libre'));
  assert.equal(E.stem('f-2024-0117'), 'f-2024-0117');
});

test('chunking valida overlap y no cruza páginas', () => {
  assert.throws(() => E.chunkPages(['a b c'], 5, 5));
  const chunks = E.chunkPages(['uno dos tres cuatro cinco', 'seis siete'], 3, 1);
  assert.deepEqual(chunks.map(c => c.page), [1, 1, 2]);
  assert.equal(chunks[1].text, 'tres cuatro cinco');
});

test('IDs de punto deterministas con formato UUID', () => {
  const again = E.buildIndex(C.DOCS, {});
  assert.equal(index.points[0].id, again.points[0].id);
  assert.match(index.points[0].id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(new Set(index.points.map(p => p.id)).size, index.points.length);
});

test('embeddings capturan paráfrasis', () => {
  const sim = E.cosine(E.embed('el gato duerme en el sofá'), E.embed('el felino descansa en el mueble'));
  const far = E.cosine(E.embed('el gato duerme en el sofá'), E.embed('la factura vence en mayo'));
  assert.ok(sim > 0.5 && far < 0.2, `sim=${sim} far=${far}`);
});

test('paráfrasis: BM25 no encuentra nada, la densa sí', () => {
  const t = E.runQuery(index, sample('parafrasis'));
  assert.equal(t.bm25.length, 0);
  assert.equal(t.dense[0].point.docKey, 'vacaciones');
  assert.equal(t.final[0].point.docKey, 'vacaciones');
});

test('código exacto: BM25 pone primero la factura correcta', () => {
  const t = E.runQuery(index, sample('codigo'));
  assert.equal(t.bm25[0].point.docKey, 'factura-0117');
  assert.match(t.generation.answer, /48,300\.00 MXN/);
});

test('RRF suma 1/(k + posición) con posiciones 1-based', () => {
  const p = id => ({ id });
  const fused = E.rrf([
    { name: 'dense', items: [{ point: p('a'), rank: 1 }, { point: p('b'), rank: 2 }] },
    { name: 'bm25', items: [{ point: p('b'), rank: 1 }] },
  ], 60);
  assert.equal(fused[0].point.id, 'b');
  assert.ok(Math.abs(fused[0].score - (1 / 62 + 1 / 61)) < 1e-12);
});

test('fuera del corpus: responde "no lo sé"', () => {
  const t = E.runQuery(index, sample('fuera'));
  assert.equal(t.final.length, 0);
  assert.equal(t.generation.answer, E.NO_ANSWER);
});

test('prompt injection: el fragmento queda en cuarentena', () => {
  const t = E.runQuery(index, sample('inyeccion'));
  assert.equal(t.generation.blocked.length, 1);
  assert.doesNotMatch(t.generation.answer, /998877665544|ya fue aprobado/);
  assert.match(t.generation.answer, /pendiente de autorización/);
});

test('verificación detecta citas inexistentes', () => {
  const t = E.runQuery(index, sample('codigo'), { hallucinate: true });
  assert.equal(t.verification.ok, false);
  assert.ok(t.verification.checks.some(c => c.status === 'cita-inexistente'));
});

test('modelo de query distinto al de la colección falla por dimensión', () => {
  assert.throws(() => E.runQuery(index, 'hola', { queryModel: 'mock-embed-large' }), { code: 'DIM_MISMATCH' });
});

test('el vector sparse de un chunk no depende del resto del corpus', () => {
  const alone = E.buildIndex([C.DOCS[0]], {});
  const p = alone.points[0];
  const q = index.points.find(x => x.id === p.id);
  assert.deepEqual(p.sparse, q.sparse);
});

test('la búsqueda híbrida equivale a una llamada a la Query API de Qdrant', () => {
  const t = E.runQuery(index, sample('codigo'));
  const req = E.qdrantRequest(t, 'acme');
  assert.deepEqual(req.prefetch.map(p => p.using), ['dense', 'bm25']);
  assert.deepEqual(req.query, { fusion: 'rrf' });
  assert.ok(req.prefetch.every(p => p.filter.must[0].key === 'tenant_id'));
  const folio = req.prefetch[1].query.indices.includes(E.sparseIndex('f-2024-0117'));
  assert.ok(folio);
  assert.equal(E.qdrantRequest(E.runQuery(index, 'hola', { mode: 'dense' })).using, 'dense');
});

test('evaluación sobre el golden set', () => {
  const r = E.evaluate(index, C.GOLDEN, {});
  assert.ok(r.recall >= 0.9, `recall=${r.recall}`);
});

test('dimensionamiento: 10M × 1536 float32 ≈ 61 GB de vectores', () => {
  const s = E.sizing({ chunks: 10e6, dims: 1536, quant: 'float32', m: 16, payloadBytes: 0, collections: 1 });
  assert.equal(Math.round(s.vectorsRam / 1e9), 61);
});
