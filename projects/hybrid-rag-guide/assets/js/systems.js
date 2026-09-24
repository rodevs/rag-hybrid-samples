/*
 * Sistemas reales que implementan lo que enseña el laboratorio.
 * `concepts` usa las claves de CONCEPTS (abajo), que enlazan a la etapa o vista del lab.
 * Las capacidades cambian entre versiones: la página invita a verificar en la documentación oficial.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RagSystems = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CONCEPTS = {
    dense: { label: 'Búsqueda densa', target: 'dense' },
    bm25: { label: 'BM25', target: 'bm25' },
    sparse: { label: 'Vectores sparse', target: 'embed' },
    fusion: { label: 'Fusión RRF', target: 'rrf' },
    rerank: { label: 'Reranking', target: 'rerank' },
    alias: { label: 'Alias / blue-green', target: '#bluegreen' },
    quant: { label: 'Cuantización', target: '#sizing' },
    eval: { label: 'Evaluación', target: '#bluegreen' },
    citations: { label: 'Citas verificables', target: 'verify' },
  };

  const GROUPS = [
    {
      title: 'Bases de datos y motores de búsqueda',
      intro: 'Donde viven los índices: guardan los vectores y los términos, y ejecutan la búsqueda híbrida.',
      items: [
        { name: 'Qdrant', kind: 'Open source (Apache 2.0) · autohospedable o en la nube', url: 'https://qdrant.tech',
          what: 'Vectores densos y sparse en la misma colección, IDF calculado en el servidor, fusión RRF con la Query API, alias de colección y cuantización. Es el que usa la guía.',
          concepts: ['dense', 'sparse', 'bm25', 'fusion', 'alias', 'quant'] },
        { name: 'OpenSearch', kind: 'Open source (Apache 2.0) · autohospedable', url: 'https://opensearch.org',
          what: 'BM25 como ranking por defecto, búsqueda k-NN de vectores, consultas híbridas con normalización o fusión de resultados, y alias de índice.',
          concepts: ['bm25', 'dense', 'fusion', 'alias'] },
        { name: 'Elasticsearch', kind: 'Autohospedable o en la nube · algunas funciones dependen de la licencia', url: 'https://www.elastic.co/elasticsearch',
          what: 'BM25 por defecto, búsqueda kNN, un retriever de fusión RRF y alias de índice para reindexar sin downtime.',
          concepts: ['bm25', 'dense', 'fusion', 'alias'] },
        { name: 'Weaviate', kind: 'Open source (BSD-3) · autohospedable o en la nube', url: 'https://weaviate.io',
          what: 'Búsqueda híbrida BM25 + vector en una sola consulta, con un parámetro para dar más peso a una u otra y fusión de los rankings.',
          concepts: ['bm25', 'dense', 'fusion'] },
        { name: 'Milvus', kind: 'Open source (Apache 2.0) · autohospedable o en la nube', url: 'https://milvus.io',
          what: 'Vectores densos y sparse por registro y búsqueda híbrida con un reranker de fusión RRF o ponderado.',
          concepts: ['dense', 'sparse', 'fusion'] },
        { name: 'Vespa', kind: 'Open source (Apache 2.0) · autohospedable o en la nube', url: 'https://vespa.ai',
          what: 'BM25, búsqueda vectorial aproximada y ranking en varias fases: una fase barata para muchos candidatos y otra más cara para los mejores.',
          concepts: ['bm25', 'dense', 'rerank'] },
        { name: 'PostgreSQL + pgvector', kind: 'Open source · autohospedable', url: 'https://github.com/pgvector/pgvector',
          what: 'Vectores con índices HNSW dentro de Postgres, junto al texto. La búsqueda de texto nativa no es BM25 exacto; ParadeDB (pg_search) agrega BM25. La fusión RRF se escribe en SQL.',
          concepts: ['dense', 'bm25', 'fusion'] },
        { name: 'Azure AI Search', kind: 'Servicio administrado de Microsoft', url: 'https://learn.microsoft.com/azure/search/',
          what: 'Búsqueda híbrida que combina texto y vectores con RRF, y un reranker semántico opcional sobre los mejores resultados.',
          concepts: ['bm25', 'dense', 'fusion', 'rerank'] },
        { name: 'Pinecone', kind: 'Servicio administrado', url: 'https://www.pinecone.io',
          what: 'Base de datos vectorial administrada con soporte para vectores densos y sparse en búsquedas híbridas.',
          concepts: ['dense', 'sparse'] },
      ],
    },
    {
      title: 'Modelos de embeddings y reranking',
      intro: 'Los que convierten texto en vectores y los que reordenan candidatos. En el lab están simulados.',
      items: [
        { name: 'OpenAI text-embedding-3', kind: 'API', url: 'https://platform.openai.com/docs/guides/embeddings',
          what: 'Modelos de embeddings densos (small y large). Es el que usa la guía; permite reducir dimensiones para ahorrar memoria.',
          concepts: ['dense', 'quant'] },
        { name: 'BGE-M3 (BAAI)', kind: 'Modelo abierto · se puede correr localmente', url: 'https://huggingface.co/BAAI/bge-m3',
          what: 'Un solo modelo multilingüe que produce vectores densos y sparse: sirve para las dos mitades de la búsqueda híbrida.',
          concepts: ['dense', 'sparse'] },
        { name: 'fastembed', kind: 'Librería open source de Qdrant', url: 'https://github.com/qdrant/fastembed',
          what: 'Genera localmente los vectores sparse BM25 (modelo Qdrant/bm25) que la guía guarda junto al vector denso.',
          concepts: ['sparse', 'bm25'] },
        { name: 'Cohere Rerank', kind: 'API', url: 'https://cohere.com/rerank',
          what: 'Cross-encoder multilingüe como servicio: recibe la pregunta y los candidatos y devuelve un score de relevancia. Es el que usa la guía.',
          concepts: ['rerank'] },
        { name: 'bge-reranker (BAAI)', kind: 'Modelo abierto · se puede correr localmente', url: 'https://huggingface.co/BAAI/bge-reranker-v2-m3',
          what: 'Cross-encoders abiertos para reordenar candidatos sin depender de una API externa.',
          concepts: ['rerank'] },
      ],
    },
    {
      title: 'Frameworks y evaluación',
      intro: 'Bibliotecas que arman el pipeline completo y herramientas para medir si funciona.',
      items: [
        { name: 'LangChain', kind: 'Open source', url: 'https://www.langchain.com',
          what: 'Su EnsembleRetriever combina varios retrievers (por ejemplo BM25 y vectorial) con Reciprocal Rank Fusion ponderado.',
          concepts: ['fusion', 'bm25', 'dense'] },
        { name: 'LlamaIndex', kind: 'Open source', url: 'https://www.llamaindex.ai',
          what: 'Retrievers de fusión que unen resultados de varias búsquedas con reciprocal rank, más postprocesadores de reranking.',
          concepts: ['fusion', 'rerank'] },
        { name: 'Haystack', kind: 'Open source (deepset)', url: 'https://haystack.deepset.ai',
          what: 'Pipelines con retrievers BM25 y de embeddings que se unen con un DocumentJoiner en modo reciprocal rank fusion, y rankers para reordenar.',
          concepts: ['bm25', 'dense', 'fusion', 'rerank'] },
        { name: 'Ragas', kind: 'Open source', url: 'https://docs.ragas.io',
          what: 'Métricas para evaluar sistemas RAG, como faithfulness y context precision, sobre un conjunto de preguntas de referencia.',
          concepts: ['eval', 'citations'] },
      ],
    },
    {
      title: 'Para leer más',
      intro: 'Una referencia pública que usa la misma combinación de técnicas.',
      items: [
        { name: 'Anthropic · Contextual Retrieval', kind: 'Artículo técnico (2024)', url: 'https://www.anthropic.com/news/contextual-retrieval',
          what: 'Describe cómo combinar embeddings y BM25, fusionar los resultados y aplicar reranking para reducir las recuperaciones fallidas en un RAG.',
          concepts: ['dense', 'bm25', 'fusion', 'rerank'] },
      ],
    },
  ];

  return { CONCEPTS, GROUPS };
});
