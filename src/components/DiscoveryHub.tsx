import React, { useState } from 'react';
import type { AskResponse, Locale, SearchResponse, ApiError } from '../lib/contracts/api';
import { formatPosition } from '../ui/i18n';

interface Props {
  lang?: Locale;
  initialQuery?: string;
}

export default function DiscoveryHub({ lang = 'en', initialQuery = '' }: Props) {
  const es = lang === 'es';
  const [activeTab, setActiveTab] = useState<'search' | 'ask'>('search');

  // Lexical search state
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [searchCountry, setSearchCountry] = useState('');
  const [searchIndustry, setSearchIndustry] = useState('');
  const [searchLimit, setSearchLimit] = useState(8);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResult, setSearchResult] = useState<SearchResponse | null>(null);

  // Grounded assistant state
  const [question, setQuestion] = useState('');
  const [askLoading, setAskLoading] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [askResult, setAskResult] = useState<AskResponse | null>(null);

  async function runLexicalSearch(e?: React.FormEvent, overrideQuery?: string) {
    if (e) e.preventDefault();
    const q = (overrideQuery !== undefined ? overrideQuery : searchQuery).trim();
    if (!q) {
      setSearchError(es ? 'Introduce términos de búsqueda.' : 'Enter search terms.');
      return;
    }
    setSearchLoading(true);
    setSearchError(null);
    try {
      const params = new URLSearchParams();
      params.set('query', q.slice(0, 220));
      params.set('limit', String(searchLimit));
      if (searchCountry.trim()) params.set('country', searchCountry.trim().toUpperCase());
      if (searchIndustry.trim()) params.set('industry', searchIndustry.trim());
      params.set('lang', lang);

      const res = await fetch(`/api/v1/public/search?${params.toString()}`, {
        headers: { 'X-Locale': lang },
      });
      const data = await res.json();
      if (!res.ok) {
        const err = data as ApiError;
        setSearchError(err?.error?.message || (es ? 'No se pudo completar la búsqueda.' : 'The search could not be completed.'));
        setSearchResult(null);
      } else {
        setSearchResult(data as SearchResponse);
      }
    } catch {
      setSearchError(es ? 'No se pudo conectar con el servicio de búsqueda.' : 'Could not reach the search endpoint.');
    } finally {
      setSearchLoading(false);
    }
  }

  async function runAskAssistant(e?: React.FormEvent, overrideQuestion?: string) {
    if (e) e.preventDefault();
    const q = (overrideQuestion !== undefined ? overrideQuestion : question).trim();
    if (!q) {
      setAskError(es ? 'Introduce una pregunta.' : 'Enter a question.');
      return;
    }
    setAskLoading(true);
    setAskError(null);
    try {
      const res = await fetch(`/api/v1/public/ask?lang=${lang}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Locale': lang,
        },
        body: JSON.stringify({ question: q, language: lang }),
      });
      const data = await res.json();
      if (!res.ok) {
        const err = data as ApiError;
        setAskError(err?.error?.message || (es ? 'No se pudo procesar la consulta.' : 'Could not process the question.'));
        setAskResult(null);
      } else {
        setAskResult(data as AskResponse);
      }
    } catch {
      setAskError(es ? 'No se pudo conectar con el asistente del directorio.' : 'Could not reach the directory assistant.');
    } finally {
      setAskLoading(false);
    }
  }

  function renderModeBadge(mode: AskResponse['mode']) {
    if (mode === 'llm_grounded') {
      return (
        <span className="badge badge-emerald">
          {es ? 'Respuesta redactada a partir de perfiles publicados' : 'Answer written from published profiles'}
        </span>
      );
    }
    if (mode === 'retrieval_only') {
      return (
        <span className="badge badge-blue">
          {es ? 'Perfiles coincidentes, sin texto de IA' : 'Matching profiles, no AI text'}
        </span>
      );
    }
    return (
      <span className="badge badge-amber">
        {es ? 'Sin información suficiente para responder' : 'Not enough information to answer'}
      </span>
    );
  }

  const sampleSearches = es
    ? [
        'importers shipment status visibility',
        'tax accounting exporters',
        'cloud security audit retailers',
        'recyclable packaging',
      ]
    : [
        'importers lack shipment status visibility',
        'tax accounting for exporters',
        'cloud security audit for retailers',
        'commercial contracts review',
      ];

  const sampleQuestions = es
    ? [
        '¿Qué empresa ayuda a importadores con visibilidad de envíos marítimos?',
        '¿Quién ofrece auditorías de seguridad en la nube para comercios?',
        '¿Qué empresa fabrica propulsores espaciales orbitales?',
      ]
    : [
        'Who helps importers with shipment visibility?',
        'Which companies provide cloud security audits or contract review?',
        'Which firm builds astronautic propulsion boosters?',
      ];

  return (
    <section
      id="discovery-hub"
      className="surface-card"
      style={{ border: '1px solid var(--border-strong)', background: 'var(--bg-elevated)' }}
      aria-label={es ? 'Buscador y asistente' : 'Search and assistant'}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: '1rem',
          marginBottom: '1.25rem',
          borderBottom: '1px solid var(--border-subtle)',
          paddingBottom: '1rem',
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: '1.45rem' }}>
            {es ? 'Encuentra una empresa por el problema que resuelve' : 'Find a company by the problem it solves'}
          </h2>
          <p className="muted" style={{ margin: '0.3rem 0 0 0' }}>
            {es
              ? 'Solo consulta perfiles aprobados y publicados por sus titulares, nunca fuentes externas.'
              : 'It only looks at profiles their owners approved and published, never at outside sources.'}
          </p>
        </div>

        <div
          role="tablist"
          aria-label={es ? 'Modo de consulta' : 'Discovery mode'}
          style={{
            display: 'inline-flex',
            background: 'var(--bg-input)',
            padding: '0.25rem',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-subtle)',
            gap: '0.25rem',
          }}
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'search'}
            onClick={() => setActiveTab('search')}
            style={{
              padding: '0.5rem 0.95rem',
              borderRadius: '4px',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '0.85rem',
              background: activeTab === 'search' ? 'var(--gold-primary)' : 'transparent',
              color: activeTab === 'search' ? '#070d17' : 'var(--text-secondary)',
            }}
          >
            {es ? 'Buscar' : 'Search'}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'ask'}
            onClick={() => setActiveTab('ask')}
            style={{
              padding: '0.5rem 0.95rem',
              borderRadius: '4px',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '0.85rem',
              background: activeTab === 'ask' ? 'var(--gold-primary)' : 'transparent',
              color: activeTab === 'ask' ? '#070d17' : 'var(--text-secondary)',
            }}
          >
            {es ? 'Preguntar al asistente' : 'Ask the assistant'}
          </button>
        </div>
      </div>

      {activeTab === 'search' ? (
        <div role="tabpanel">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.85rem' }}>
            <span className="muted" style={{ fontSize: '0.82rem' }}>
              {es
                ? 'Busca por palabras en problemas, soluciones, servicios, resumen e industria. No interpreta sinónimos ni usa IA.'
                : 'Searches for your words in problems, solutions, services, summaries and industry. It does not interpret synonyms or use AI.'}
            </span>
          </div>

          <form onSubmit={(e) => runLexicalSearch(e)} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label htmlFor="lexical-search-input">
                  {es ? 'Términos de búsqueda (problema de negocio, servicio o capacidad)' : 'Search terms (business problem, service, or capability)'}
                </label>
                <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                  <input
                    id="lexical-search-input"
                    type="search"
                    maxLength={220}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={
                      es
                        ? 'Ej. importers lack shipment status visibility, cloud security, tax accounting...'
                        : 'e.g. importers lack shipment status visibility, cloud security, contract review...'
                    }
                    style={{ flex: '1 1 260px' }}
                  />
                  <button type="submit" className="btn-primary" disabled={searchLoading}>
                    {searchLoading ? (es ? 'Buscando…' : 'Searching…') : es ? 'Buscar' : 'Search'}
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="lexical-country">{es ? 'País (opcional, código de 2 letras)' : 'Country (optional, 2-letter code)'}</label>
                <input
                  id="lexical-country"
                  type="text"
                  maxLength={2}
                  value={searchCountry}
                  onChange={(e) => setSearchCountry(e.target.value.toUpperCase())}
                  placeholder="US, CO, MX..."
                />
              </div>

              <div>
                <label htmlFor="lexical-industry">{es ? 'Industria (opcional)' : 'Industry (optional)'}</label>
                <input
                  id="lexical-industry"
                  type="text"
                  maxLength={100}
                  value={searchIndustry}
                  onChange={(e) => setSearchIndustry(e.target.value)}
                  placeholder={es ? 'Ej. Logistics, Accounting...' : 'e.g. Freight, Cybersecurity...'}
                />
              </div>

              <div>
                <label htmlFor="lexical-limit">{es ? 'Número de resultados' : 'Number of results'}</label>
                <select
                  id="lexical-limit"
                  value={searchLimit}
                  onChange={(e) => setSearchLimit(Number(e.target.value))}
                >
                  <option value={4}>4</option>
                  <option value={8}>8</option>
                  <option value={12}>12</option>
                </select>
              </div>
            </div>
          </form>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap', marginTop: '0.85rem' }}>
            <span className="muted" style={{ fontSize: '0.78rem' }}>
              {es ? 'Consultas de prueba:' : 'Sample queries:'}
            </span>
            {sampleSearches.map((sample) => (
              <button
                key={sample}
                type="button"
                className="btn-secondary btn-sm"
                style={{ padding: '0.25rem 0.6rem', fontSize: '0.76rem' }}
                onClick={() => {
                  setSearchQuery(sample);
                  runLexicalSearch(undefined, sample);
                }}
              >
                {sample}
              </button>
            ))}
          </div>

          {searchError && (
            <div className="notice notice-error" role="alert" style={{ marginTop: '1rem' }}>
              {searchError}
            </div>
          )}

          {searchResult && (
            <div style={{ marginTop: '1.25rem', paddingTop: '1.25rem', borderTop: '1px solid var(--border-subtle)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
                <div>
                  <strong>
                    {searchResult.count}{' '}
                    {es
                      ? searchResult.count === 1 ? 'perfil publicado coincide con' : 'perfiles publicados coinciden con'
                      : searchResult.count === 1 ? 'published profile matches' : 'published profiles match'}
                  </strong>{' '}
                  <span className="mono muted">("{searchResult.query}")</span>
                </div>
              </div>

              {searchResult.items.length === 0 ? (
                <p className="muted">
                  {es
                    ? 'No se encontraron perfiles publicados con esos términos exactos.'
                    : 'No published profiles match those words.'}
                </p>
              ) : (
                <div className="grid-2">
                  {searchResult.items.map((item) => (
                    <article
                      key={item.companyId}
                      style={{
                        padding: '1.1rem',
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--bg-surface)',
                        border: '1px solid var(--border-subtle)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                        <span className="badge badge-gold mono">{formatPosition(item.position)}</span>
                        <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', flexWrap: 'wrap' }}>
                          {item.name.toLowerCase().startsWith('demo ') && (
                            <span className="badge badge-amber mono">DEMO</span>
                          )}
                          {item.industry && <span className="badge badge-slate">{item.industry}</span>}
                          <span className="badge badge-blue mono">{item.country}</span>
                        </div>
                      </div>

                      <h4 style={{ margin: '0 0 0.35rem 0', fontSize: '1.1rem' }}>
                        <a href={es ? `/es/empresas/${item.slug}` : item.url}>{item.name}</a>
                      </h4>
                      <p style={{ fontSize: '0.88rem', marginBottom: '0.65rem' }}>{item.summary}</p>

                      {item.evidence && (
                        <div
                          style={{
                            padding: '0.55rem 0.75rem',
                            borderRadius: '6px',
                            background: 'rgba(238, 198, 121, 0.06)',
                            borderLeft: '2px solid var(--gold-primary)',
                            fontSize: '0.82rem',
                            marginBottom: '0.65rem',
                          }}
                        >
                          <span style={{ color: 'var(--text-primary)' }}>"{item.evidence.quote}"</span>
                        </div>
                      )}

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', fontSize: '0.8rem' }}>
                        <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                          {item.matchedTerms.map((t) => (
                            <span key={t} className="badge badge-slate mono" style={{ fontSize: '0.7rem' }}>
                              {t}
                            </span>
                          ))}
                        </div>
                        <div style={{ display: 'flex', gap: '0.75rem' }}>
                          <a href={es ? `/es/empresas/${item.slug}` : item.url} style={{ fontWeight: 600 }}>
                            {es ? 'Abrir ficha →' : 'Open profile →'}
                          </a>
                          <a href={item.jsonldUrl} className="mono muted">
                            JSON-LD (v{item.version})
                          </a>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div role="tabpanel">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.85rem' }}>
            <span className="badge badge-gold">
              {es ? 'Asistente con citas de perfiles publicados' : 'Assistant that cites published profiles'}
            </span>
            <span className="muted" style={{ fontSize: '0.82rem' }}>
              {es
                ? 'Responde únicamente con citas verificables de perfiles publicados. Si no hay evidencia suficiente, se abstiene.'
                : 'Answers strictly using verifiable citations from published profiles. Abstains when evidence is insufficient.'}
            </span>
          </div>

          <form onSubmit={(e) => runAskAssistant(e)}>
            <label htmlFor="ask-assistant-input">
              {es ? 'Formula una pregunta sobre capacidades, problemas o servicios en el directorio' : 'Ask a question about capabilities, business problems, or services in the directory'}
            </label>
            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
              <input
                id="ask-assistant-input"
                type="text"
                maxLength={500}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder={
                  es
                    ? 'Ej. ¿Quién ayuda a importadores con visibilidad de envíos?'
                    : 'e.g. Who helps importers with shipment visibility?'
                }
                style={{ flex: '1 1 280px' }}
              />
              <button type="submit" className="btn-primary" disabled={askLoading}>
                {askLoading ? (es ? 'Consultando evidencia…' : 'Checking evidence…') : es ? 'Consultar asistente' : 'Ask assistant'}
              </button>
            </div>
          </form>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap', marginTop: '0.85rem' }}>
            <span className="muted" style={{ fontSize: '0.78rem' }}>
              {es ? 'Preguntas de ejemplo:' : 'Sample questions:'}
            </span>
            {sampleQuestions.map((q) => (
              <button
                key={q}
                type="button"
                className="btn-secondary btn-sm"
                style={{ padding: '0.25rem 0.6rem', fontSize: '0.76rem' }}
                onClick={() => {
                  setQuestion(q);
                  runAskAssistant(undefined, q);
                }}
              >
                {q}
              </button>
            ))}
          </div>

          {askError && (
            <div className="notice notice-error" role="alert" style={{ marginTop: '1rem' }}>
              {askError}
            </div>
          )}

          {askResult && (
            <div
              style={{
                marginTop: '1.25rem',
                padding: '1.25rem',
                borderRadius: 'var(--radius-md)',
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.85rem' }}>
                {renderModeBadge(askResult.mode)}
                <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  {askResult.degraded && (
                    <span className="badge badge-amber mono" title={es ? 'Razón de modo sin LLM' : 'Fallback reason'}>
                      {askResult.degraded}
                    </span>
                  )}
                </div>
              </div>

              <div
                style={{
                  padding: '1rem',
                  borderRadius: 'var(--radius-sm)',
                  background: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                  fontSize: '0.96rem',
                  lineHeight: 1.65,
                  marginBottom: '1rem',
                }}
              >
                {askResult.answer}
              </div>

              {askResult.citations && askResult.citations.length > 0 && (
                <div style={{ marginBottom: '1rem' }}>
                  <h4 style={{ fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--gold-primary)', marginBottom: '0.65rem' }}>
                    {es ? `Citas verificables (${askResult.citations.length})` : `Verifiable Profile Citations (${askResult.citations.length})`}
                  </h4>
                  <div style={{ display: 'grid', gap: '0.65rem' }}>
                    {askResult.citations.map((cite, idx) => (
                      <div
                        key={`${cite.companyId}-${idx}`}
                        style={{
                          padding: '0.85rem 1rem',
                          borderRadius: 'var(--radius-sm)',
                          background: 'rgba(238, 198, 121, 0.05)',
                          border: '1px solid var(--border-gold)',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.35rem' }}>
                          <a href={cite.url} style={{ fontWeight: 700, fontSize: '0.95rem' }}>
                            {cite.title}
                          </a>
                          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                            <span className="badge badge-slate mono">v{cite.profileVersion}</span>
                            <a href={cite.jsonldUrl} className="mono" style={{ fontSize: '0.75rem', textDecoration: 'underline' }}>
                              JSON-LD
                            </a>
                          </div>
                        </div>
                        <blockquote style={{ margin: '0.25rem 0 0 0', fontSize: '0.86rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                          "{cite.quote}"
                        </blockquote>
                        {cite.jsonldDigest && (
                          <div className="mono muted" style={{ fontSize: '0.7rem', marginTop: '0.35rem' }}>
                            {es ? 'Huella del perfil citado' : 'Cited profile fingerprint'}: {cite.jsonldDigest.slice(0, 12)}…
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div
                className="notice"
                style={{ margin: 0, fontSize: '0.82rem', padding: '0.75rem 1rem' }}
              >
                <strong>{es ? 'Límites de esta respuesta:' : 'Limits of this answer:'}</strong> {askResult.limitations}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
