import React, { useState } from 'react';
import type { AskResponse, Locale, SearchResponse, ApiError } from '../lib/contracts/api';
import { formatPosition } from '../ui/i18n';
import { isDemoName, monogram, tileLook, type MosaicCompany } from '../lib/mosaic';
import '../styles/discovery.css';

interface Props {
  lang?: Locale;
  initialQuery?: string;
  /** Companies shown before anyone searches. On the Home the section supplies its own heading. */
  featured?: MosaicCompany[];
  bare?: boolean;
}

export default function DiscoveryHub({ lang = 'en', initialQuery = '', featured = [], bare = false }: Props) {
  const es = lang === 'es';
  const prefix = es ? '/es' : '';
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

  function modeLabel(result: AskResponse) {
    if (result.mode === 'llm_grounded') return es ? 'Respuesta redactada a partir de perfiles publicados' : 'Answer written from published profiles';
    if (result.mode === 'retrieval_only') return es ? 'Perfiles coincidentes, sin texto de IA' : 'Matching profiles, no AI text';
    return es ? 'Sin información suficiente para responder' : 'Not enough information to answer';
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

  const profileHref = (slug: string, url: string) => (es ? `/es/empresas/${slug}` : url);

  return (
    <section id="discovery-hub" className={`dh${bare ? ' dh-bare' : ''}`} aria-label={es ? 'Buscador y asistente' : 'Search and assistant'}>
      {!bare && (
        <header className="dh-head">
          <h2>{es ? 'Encuentra una empresa por el problema que resuelve' : 'Find a company by the problem it solves'}</h2>
          <p>
            {es
              ? 'Solo consulta perfiles aprobados y publicados por sus titulares, nunca fuentes externas.'
              : 'It only looks at profiles their owners approved and published, never at outside sources.'}
          </p>
        </header>
      )}

      <div className="dh-modes" role="tablist" aria-label={es ? 'Modo de consulta' : 'Discovery mode'}>
        <button type="button" role="tab" aria-selected={activeTab === 'search'} onClick={() => setActiveTab('search')}>
          {es ? 'Buscar en perfiles' : 'Search profiles'}
        </button>
        <button type="button" role="tab" aria-selected={activeTab === 'ask'} onClick={() => setActiveTab('ask')}>
          {es ? 'Preguntar al asistente' : 'Ask the assistant'}
        </button>
      </div>

      {activeTab === 'search' ? (
        <div role="tabpanel">
          <form className="dh-door" action={`${prefix}/empresas`} method="get" onSubmit={(e) => runLexicalSearch(e)}>
            <div className="dh-field">
              <label htmlFor="lexical-search-input" className="dh-label">
                {es ? 'Problema de negocio, servicio o capacidad' : 'Business problem, service or capability'}
              </label>
              <input
                id="lexical-search-input"
                name="query"
                type="search"
                maxLength={220}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={es ? '¿Qué necesitas resolver?' : 'What do you need solved?'}
              />
              <button type="submit" className="dh-go" disabled={searchLoading}>
                {searchLoading ? (es ? 'Buscando…' : 'Searching…') : es ? 'Buscar' : 'Search'}
              </button>
            </div>

            <p className="dh-honest">
              {es
                ? 'Busca tus palabras en problemas, soluciones, servicios, resumen e industria. No interpreta sinónimos ni usa IA.'
                : 'Searches for your words in problems, solutions, services, summaries and industry. It does not interpret synonyms or use AI.'}
            </p>

            <details className="dh-refine">
              <summary>{es ? 'Afinar la búsqueda' : 'Refine the search'}</summary>
              <div className="dh-refine-grid">
                <div>
                  <label htmlFor="lexical-country">{es ? 'País (código de 2 letras)' : 'Country (2-letter code)'}</label>
                  <input id="lexical-country" name="country" type="text" maxLength={2} value={searchCountry}
                    onChange={(e) => setSearchCountry(e.target.value.toUpperCase())} placeholder="US, CO, MX" />
                </div>
                <div>
                  <label htmlFor="lexical-industry">{es ? 'Industria' : 'Industry'}</label>
                  <input id="lexical-industry" name="industry" type="text" maxLength={100} value={searchIndustry}
                    onChange={(e) => setSearchIndustry(e.target.value)} placeholder={es ? 'Ej. Logistics' : 'e.g. Freight'} />
                </div>
                <div>
                  <label htmlFor="lexical-limit">{es ? 'Número de resultados' : 'Number of results'}</label>
                  <select id="lexical-limit" value={searchLimit} onChange={(e) => setSearchLimit(Number(e.target.value))}>
                    <option value={4}>4</option>
                    <option value={8}>8</option>
                    <option value={12}>12</option>
                  </select>
                </div>
              </div>
            </details>
          </form>

          <div className="dh-try">
            <span>{es ? 'Prueba con' : 'Try'}</span>
            {sampleSearches.map((sample) => (
              <button key={sample} type="button" onClick={() => { setSearchQuery(sample); runLexicalSearch(undefined, sample); }}>
                {sample}
              </button>
            ))}
          </div>

          {searchError && <div className="dh-error" role="alert">{searchError}</div>}

          {searchResult && (
            <div className="dh-results" aria-live="polite">
              <p className="dh-count">
                <strong>
                  {searchResult.count}{' '}
                  {es
                    ? searchResult.count === 1 ? 'perfil publicado coincide con' : 'perfiles publicados coinciden con'
                    : searchResult.count === 1 ? 'published profile matches' : 'published profiles match'}
                </strong>{' '}
                «{searchResult.query}»
              </p>
              {searchResult.items.length === 0 ? (
                <p className="dh-empty">
                  {es
                    ? 'No se encontraron perfiles publicados con esos términos exactos. Prueba con menos palabras, o con la palabra que usaría la empresa.'
                    : 'No published profiles match those words. Try fewer words, or the word the company itself would use.'}
                </p>
              ) : (
                <div className="dh-grid">
                  {searchResult.items.map((item, i) => {
                    const look = tileLook(item.slug);
                    return (
                      <article key={item.companyId} className="dh-card" style={{ '--bg': look.color.bg, '--ink': look.color.ink, '--i': i } as React.CSSProperties}>
                        <header className="dh-card-band">
                          <span className="dh-card-mark" aria-hidden="true">{monogram(item.name)}</span>
                          <span className="dh-card-no">{formatPosition(item.position)}</span>
                          {isDemoName(item.name) && <span className="dh-card-demo">Demo</span>}
                        </header>
                        <div className="dh-card-body">
                          <h3><a href={profileHref(item.slug, item.url)}>{item.name}</a></h3>
                          <p className="dh-card-meta">{[item.industry, item.country].filter(Boolean).join(', ')}</p>
                          <p>{item.summary}</p>
                          {item.evidence && <blockquote>«{item.evidence.quote}»</blockquote>}
                          <div className="dh-terms">
                            {item.matchedTerms.map((term) => <mark key={term}>{term}</mark>)}
                          </div>
                          <footer>
                            <a href={profileHref(item.slug, item.url)}>{es ? 'Abrir perfil' : 'Open profile'}</a>
                            <a href={item.jsonldUrl} className="dh-data">{es ? `Datos del perfil (v${item.version})` : `Profile data (v${item.version})`}</a>
                          </footer>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div role="tabpanel">
          <form className="dh-door" onSubmit={(e) => runAskAssistant(e)}>
            <div className="dh-field">
              <label htmlFor="ask-assistant-input" className="dh-label">
                {es ? 'Pregunta sobre capacidades, problemas o servicios del directorio' : 'A question about capabilities, problems or services in the directory'}
              </label>
              <input
                id="ask-assistant-input"
                type="text"
                maxLength={500}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder={es ? '¿Quién ayuda a importadores?' : 'Who helps importers?'}
              />
              <button type="submit" className="dh-go" disabled={askLoading}>
                {askLoading ? (es ? 'Consultando…' : 'Checking…') : es ? 'Preguntar' : 'Ask'}
              </button>
            </div>
            <p className="dh-honest">
              {es
                ? 'Responde únicamente con citas verificables de perfiles publicados. Si no hay evidencia suficiente, se abstiene.'
                : 'Answers strictly using verifiable citations from published profiles. Abstains when evidence is insufficient.'}
            </p>
          </form>

          <div className="dh-try">
            <span>{es ? 'Prueba con' : 'Try'}</span>
            {sampleQuestions.map((q) => (
              <button key={q} type="button" onClick={() => { setQuestion(q); runAskAssistant(undefined, q); }}>
                {q}
              </button>
            ))}
          </div>

          {askError && <div className="dh-error" role="alert">{askError}</div>}

          {askResult && (
            <div className="dh-answer" aria-live="polite">
              <p className={`dh-mode dh-mode-${askResult.mode}`} title={askResult.degraded ?? undefined}>{modeLabel(askResult)}</p>
              <p className="dh-answer-text">{askResult.answer}</p>

              {askResult.citations && askResult.citations.length > 0 && (
                <div className="dh-cites">
                  <h3>{es ? `Citas verificables (${askResult.citations.length})` : `Verifiable citations (${askResult.citations.length})`}</h3>
                  {askResult.citations.map((cite, idx) => (
                    <div key={`${cite.companyId}-${idx}`} className="dh-cite">
                      <div>
                        <a href={cite.url}>{cite.title}</a>
                        <a href={cite.jsonldUrl} className="dh-data">{es ? `Datos del perfil (v${cite.profileVersion})` : `Profile data (v${cite.profileVersion})`}</a>
                      </div>
                      <blockquote>«{cite.quote}»</blockquote>
                      {cite.jsonldDigest && (
                        <small>{es ? 'Huella del perfil citado' : 'Cited profile fingerprint'}: {cite.jsonldDigest.slice(0, 12)}…</small>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <p className="dh-limits">
                <strong>{es ? 'Límites de esta respuesta:' : 'Limits of this answer:'}</strong> {askResult.limitations}
              </p>
            </div>
          )}
        </div>
      )}

      {featured.length > 0 && !searchResult && !askResult && (
        <div className="dh-rail">
          <h3>{es ? 'Ya en el muro' : 'Already on the wall'}</h3>
          <ul>
            {featured.map((c) => {
              const look = tileLook(c.slug);
              return (
                <li key={c.slug}>
                  <a href={`${prefix}/empresas/${c.slug}`} style={{ '--bg': look.color.bg, '--ink': look.color.ink } as React.CSSProperties}>
                    <span className="dh-rail-mark" aria-hidden="true">{monogram(c.name)}</span>
                    <span className="dh-rail-no">{formatPosition(c.position)}</span>
                    <strong>{c.name}</strong>
                    <span>{c.industry}</span>
                    {isDemoName(c.name) && <em>{es ? 'Demostración' : 'Demonstration'}</em>}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
