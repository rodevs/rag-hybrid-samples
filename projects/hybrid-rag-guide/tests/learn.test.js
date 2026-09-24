// Integridad del contenido didáctico: glosario, enlaces, comprobaciones y respuestas sin RAG.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../assets/js/learn.js');
const C = require('../assets/js/corpus.js');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'assets/js/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const stageIds = [...app.slice(app.indexOf('const STAGES = ['), app.indexOf('const stageIdx')).matchAll(/\{ id: '([a-z0-9]+)'/g)].map(m => m[1]);
const VIEWS = ['#bluegreen', '#sizing'];

test('el recorrido tiene 15 pasos, del problema al resumen', () => {
  assert.equal(stageIds.length, 15);
  assert.equal(stageIds[0], 'problem');
  assert.equal(stageIds[stageIds.length - 1], 'summary');
});

test('cada término del glosario está completo y enlaza a un paso o vista existente', () => {
  for (const [key, g] of Object.entries(L.GLOSSARY)) {
    assert.ok(g.term && g.def, `${key} sin término o definición`);
    assert.ok(stageIds.includes(g.lab) || VIEWS.includes(g.lab), `${key}: destino desconocido ${g.lab}`);
    for (const r of g.rel || []) assert.ok(L.GLOSSARY[r], `${key}: relacionado desconocido ${r}`);
  }
});

test('todos los términos marcados en el lab y en la página existen en el glosario', () => {
  const code = app.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');   // sin comentarios
  const marked = [...code.matchAll(/\[\[([a-z0-9]+)(?:\|[^\]]+)?\]\]/g)].map(m => m[1])
    .concat([...html.matchAll(/data-term="([a-z0-9]+)"/g)].map(m => m[1]));
  assert.ok(marked.length > 40);
  for (const k of marked) assert.ok(L.GLOSSARY[k], `término sin definir: ${k}`);
});

test('cada paso tiene un reto "Experimenta"', () => {
  const block = app.slice(app.indexOf('const CHALLENGES = {'), app.indexOf('function metric'));
  for (const id of stageIds) assert.match(block, new RegExp(`\\n    ${id}: \\{`), `falta reto para ${id}`);
});

test('las comprobaciones tienen respuestas válidas e IDs únicos', () => {
  const ids = new Set();
  for (const qs of Object.values(L.QUIZZES)) {
    for (const q of qs) {
      assert.ok(q.answer >= 0 && q.answer < q.options.length, q.id);
      assert.ok(q.why, q.id);
      assert.ok(!ids.has(q.id), `id repetido ${q.id}`);
      ids.add(q.id);
    }
  }
});

test('hay una respuesta sin RAG para cada pregunta de ejemplo', () => {
  for (const s of C.SAMPLE_QUERIES) assert.ok(L.NO_RAG[s.id], s.id);
  assert.ok(L.NO_RAG.otra);
});
